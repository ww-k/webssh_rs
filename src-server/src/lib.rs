pub mod api_doc;
pub mod apis;
mod config;
mod consts;
pub mod entities;
pub mod log_buffer;
mod mcp;
mod migrations;
mod repositories;
pub mod sftp_client;
pub mod ssh_connection_pool;
#[cfg(test)]
mod tests;

use std::{
    convert::Infallible, future::Future, ops::Deref, path::PathBuf, sync::Arc, time::Duration,
};

use axum::{
    Router,
    body::Body,
    http::{HeaderMap, StatusCode, header},
    response::{
        Response,
        sse::{Event, KeepAlive, Sse},
    },
    routing::get,
};
use config::Config;
use futures_util::stream::Stream;
use sea_orm::{Database, DatabaseConnection};
use tower_http::cors::CorsLayer;
use tracing_subscriber::{EnvFilter, FmtSubscriber};

use apis::{
    favorite_directory, fs, preferences, sftp, ssh, ssh_connection, ssh_known_host, target,
    transfer, user_data,
};
use migrations::{Migrator, MigratorTrait};
use utoipa::OpenApi;

use crate::{api_doc::ApiDoc, ssh_connection_pool::SshConnectionPool};

const DEFAULT_SERVER_PORT: u16 = 10086;

static CLIENT_DIST: include_dir::Dir<'static> =
    include_dir::include_dir!("$CARGO_MANIFEST_DIR/../src-client/dist");

pub struct AppBaseState {
    db: DatabaseConnection,
    config: Config,
}

pub struct AppState {
    base_state: Arc<AppBaseState>,
    connection_pool: Arc<SshConnectionPool>,
    transfer_service: transfer::TransferService,
}

impl Deref for AppState {
    type Target = AppBaseState;

    fn deref(&self) -> &Self::Target {
        &self.base_state
    }
}

pub async fn run_server() {
    init_logging();
    let port = std::env::var("WEBSSH_RS_SERVER_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_SERVER_PORT);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .unwrap();
    run_server_with_listener(listener, std::future::pending()).await;
}

pub fn init_logging() {
    let env_log =
        std::env::var("RUST_LOG").unwrap_or_else(|_| "webssh_rs_server=debug,off".to_string());
    let subscriber = FmtSubscriber::builder()
        .with_env_filter(EnvFilter::new(env_log))
        .with_writer(log_buffer::LogWriter::new(log_buffer::log_buffer()))
        .finish();

    let _ = tracing::subscriber::set_global_default(subscriber);
}

fn default_db_path() -> PathBuf {
    dirs::data_dir()
        .map(|path| path.join(env!("CARGO_PKG_NAME")).join("db.sqlite"))
        .unwrap_or_else(|| PathBuf::from("target/db.sqlite"))
}

pub async fn run_server_with_listener<F>(listener: tokio::net::TcpListener, shutdown: F)
where
    F: Future<Output = ()> + Send + 'static,
{
    tracing::info!("Starting server...");

    let config = Config::load_config().await.unwrap();

    let db_path = std::env::var_os("WEBSSH_RS_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(default_db_path);
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).expect("Failed to create database directory");
    }
    let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

    tracing::info!(db_url = %db_url, "Database configured");

    let db = Database::connect(&db_url)
        .await
        .expect("Database connection failed");

    Migrator::up(&db, None).await.unwrap();

    let app_base_state = Arc::new(AppBaseState { db, config });
    let connection_pool = Arc::new(SshConnectionPool::new(
        app_base_state.db.clone(),
        app_base_state.config.check_server_key,
        app_base_state.config.max_connections_per_target as usize,
        app_base_state.config.max_channels_per_connection as usize,
    ));
    let transfer_service =
        transfer::TransferService::new(app_base_state.clone(), connection_pool.clone());
    transfer_service.init_pending_tasks().await.unwrap();

    let app_state = Arc::new(AppState {
        base_state: app_base_state.clone(),
        connection_pool: connection_pool.clone(),
        transfer_service,
    });

    let app = Router::new()
        .route("/api/logs", get(get_logs))
        .route("/api/logs/stream", get(stream_logs))
        .nest(
            "/api/ssh_known_host",
            ssh_known_host::router_builder(app_state.clone()),
        )
        .route(
            "/api/health",
            get(|| async { axum::Json(serde_json::json!({ "status": "ok" })) }),
        )
        .nest(
            "/api/ssh_connection",
            ssh_connection::router_builder(connection_pool.clone()),
        )
        .nest("/api/ssh", ssh::router_builder(connection_pool.clone()))
        .nest("/api/sftp", sftp::router_builder(app_state.clone()))
        .nest("/api/fs", fs::router_builder(app_base_state.clone()))
        .nest(
            "/api/favorite_directory",
            favorite_directory::router_builder(app_state.clone()),
        )
        .nest("/api/transfer", transfer::router_builder(app_state.clone()))
        .nest("/api/target", target::router_builder(app_state.clone()))
        .nest(
            "/api/user_data",
            user_data::router_builder(app_state.clone()),
        )
        .nest("/mcp", mcp::router_builder(app_state.clone()))
        .nest("/api/mcp", mcp::router_builder(app_state.clone()))
        .merge(preferences::router_builder(app_state.clone()))
        .route(
            "/api-docs/openapi.json",
            axum::routing::get(|| async { axum::Json(ApiDoc::openapi()) }),
        )
        .route(
            "/api-docs",
            axum::routing::get(|| async { axum::response::Html(include_str!("../redoc.html")) }),
        )
        .fallback(serve_client)
        .layer(CorsLayer::permissive());

    tracing::info!("Listening on http://{}", listener.local_addr().unwrap());

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
        .unwrap();
}

#[utoipa::path(
    get,
    path = "/api/logs",
    tag = "server_logs",
    summary = "获取服务端日志",
    responses(
        (status = 200, description = "最近的服务端日志", body = [String])
    )
)]
pub async fn get_logs() -> axum::Json<Vec<String>> {
    axum::Json(log_buffer::log_buffer().lines())
}

fn snapshot_event(
    entries: &[log_buffer::LogEntry],
    latest_id: Option<u64>,
    replace_terminal: bool,
) -> Event {
    let data = entries
        .iter()
        .map(|entry| entry.line.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let event = Event::default()
        .event(if replace_terminal {
            "snapshot"
        } else {
            "resume"
        })
        .data(data);
    if let Some(id) = latest_id {
        event.id(id.to_string())
    } else {
        event
    }
}

#[utoipa::path(
    get,
    path = "/api/logs/stream",
    tag = "server_logs",
    summary = "实时推送服务端日志",
    responses(
        (status = 200, description = "服务端日志 SSE 流", content_type = "text/event-stream")
    )
)]
pub async fn stream_logs(headers: HeaderMap) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let after_id = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    let buffer = log_buffer::log_buffer();
    let (entries, latest_id, mut receiver, mut replace_terminal) =
        buffer.subscribe_with_snapshot(after_id);

    let stream = async_stream::stream! {
        yield Ok(snapshot_event(
            &entries,
            latest_id,
            replace_terminal,
        ));

        loop {
            match receiver.recv().await {
                Ok(entry) => {
                    yield Ok(Event::default()
                        .event("log")
                        .id(entry.id.to_string())
                        .data(entry.line));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    let (entries, latest_id, next_receiver, next_replace_terminal) =
                        buffer.subscribe_with_snapshot(None);
                    receiver = next_receiver;
                    replace_terminal = next_replace_terminal;
                    yield Ok(snapshot_event(
                        &entries,
                        latest_id,
                        replace_terminal,
                    ));
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

async fn serve_client(uri: axum::http::Uri) -> Response<Body> {
    let path = uri.path().trim_start_matches('/');
    let file = if path.is_empty() { "index.html" } else { path };

    if let Some(file) = CLIENT_DIST.get_file(file) {
        let content_type = mime_guess::from_path(file.path())
            .first_or_octet_stream()
            .as_ref()
            .to_string();
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .body(Body::from(file.contents().to_vec()))
            .expect("valid static file response");
    }

    if !path.starts_with("api/") {
        if let Some(index) = CLIENT_DIST.get_file("index.html") {
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                .body(Body::from(index.contents().to_vec()))
                .expect("valid index response");
        }
    }

    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Body::from("404 Not Found"))
        .expect("valid not found response")
}
