mod apis;
mod config;
mod consts;
mod entities;
mod migrations;
mod ssh_session_pool;
#[cfg(test)]
mod tests;

use std::{ops::Deref, sync::Arc};

use axum::{Router, http::StatusCode, routing::any};
use config::Config;
use sea_orm::{Database, DatabaseConnection};
use tracing_subscriber::{EnvFilter, FmtSubscriber};

use apis::{sftp, ssh, ssh_connection, target};
use migrations::{Migrator, MigratorTrait};
use utoipa::OpenApi;

use crate::ssh_session_pool::SshSessionPool;

#[derive(OpenApi)]
#[openapi(
    paths(
        target::target_list,
        target::target_add,
        target::target_update,
        target::target_remove,
        apis::handlers::ssh_connection::list::handler,
        apis::handlers::ssh_connection::expire::handler,
        apis::handlers::ssh::exec::handler,
        apis::handlers::sftp::ls::handler,
        apis::handlers::sftp::mkdir::handler,
        apis::handlers::sftp::stat::handler,
        apis::handlers::sftp::home::handler,
        apis::handlers::sftp::cp::handler,
        apis::handlers::sftp::rename::handler,
        apis::handlers::sftp::rm::handler,
        apis::handlers::sftp::rm_rf::handler,
        apis::handlers::sftp::upload::handler,
        apis::handlers::sftp::download::handler,
    ),
    components(
        schemas(
            entities::target::Model,
            entities::target::TargetAuthMethod,
            target::TargetUpdatePayload,
            target::TargetRemovePayload,
            ssh_session_pool::ConnectionInfo,
            apis::ApiErr,
            apis::handlers::QueryTargetId,
            apis::handlers::sftp::SftpFile,
            apis::handlers::sftp::ls::SftpLsPayload,
            apis::handlers::ssh_connection::expire::SshSessionExpirePayload,
            apis::handlers::sftp::upload::SftpUploadResponse,
        )
    ),
    tags(
        (name = "target", description = "SSH 目标管理 API"),
        (name = "ssh_connection", description = "SSH 连接管理 API"),
        (name = "ssh", description = "SSH 命令执行 API"),
        (name = "sftp", description = "SFTP 文件管理 API")
    ),
    info(
        title = "WebSSH RS API",
        description = "WebSSH RS 后端 API 文档",
        version = "0.1.0",
        contact(
            name = "API Support",
            //email = "support@example.com"
        )
    )
)]
struct ApiDoc;

struct AppBaseState {
    db: DatabaseConnection,
    config: Config,
}

struct AppState {
    base_state: Arc<AppBaseState>,
    session_pool: Arc<SshSessionPool>,
}

impl Deref for AppState {
    type Target = AppBaseState;

    fn deref(&self) -> &Self::Target {
        &self.base_state
    }
}

pub async fn run_server() {
    let env_log =
        std::env::var("RUST_LOG").unwrap_or_else(|_| "webssh_rs_server=debug,off".to_string());
    let subscriber = FmtSubscriber::builder()
        // 优先使用RUST_LOG环境变量，没有则用默认
        .with_env_filter(EnvFilter::new(env_log))
        .finish();

    tracing::subscriber::set_global_default(subscriber).unwrap();

    println!("Starting server...");

    let config = Config::load_config().await.unwrap();

    let db = Database::connect("sqlite:target/db.sqlite?mode=rwc")
        .await
        .expect("Database connection failed");

    Migrator::up(&db, None).await.unwrap();

    let app_base_state = Arc::new(AppBaseState { db, config });
    let session_pool = Arc::new(SshSessionPool::new(app_base_state.clone()));

    let app_state = Arc::new(AppState {
        base_state: app_base_state.clone(),
        session_pool: session_pool.clone(),
    });

    let app = Router::new()
        .nest(
            "/api/ssh_connection",
            ssh_connection::router_builder(session_pool.clone()),
        )
        .nest("/api/ssh", ssh::router_builder(session_pool.clone()))
        .nest("/api/sftp", sftp::router_builder(app_state.clone()))
        .nest(
            "/api/target",
            target::router_builder(app_base_state.clone()),
        )
        .route(
            "/api-docs/openapi.json",
            axum::routing::get(|| async { axum::Json(ApiDoc::openapi()) }),
        )
        .route(
            "/api-docs",
            axum::routing::get(|| async { axum::response::Html(include_str!("../redoc.html")) }),
        )
        .fallback(any(|| async { (StatusCode::NOT_FOUND, "404 Not Found") }));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8080")
        .await
        .unwrap();

    println!("Listening on http://{}", listener.local_addr().unwrap());

    axum::serve(listener, app).await.unwrap();
}
