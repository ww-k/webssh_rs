pub mod api_doc;
pub mod apis;
mod config;
mod consts;
pub mod entities;
mod migrations;
mod repositories;
pub mod sftp_client;
pub mod ssh_connection_pool;
mod target_ssh_service;
#[cfg(test)]
mod tests;

use std::{ops::Deref, sync::Arc};

use axum::{Router, http::StatusCode, routing::any};
use config::Config;
use sea_orm::{Database, DatabaseConnection};
use tracing_subscriber::{EnvFilter, FmtSubscriber};

use apis::{fs, sftp, ssh, ssh_connection, target, transfer};
use migrations::{Migrator, MigratorTrait};
use utoipa::OpenApi;

use crate::target_ssh_service::TargetSshService;
use crate::{api_doc::ApiDoc, ssh_connection_pool::SshConnectionPool};

pub struct AppBaseState {
    db: DatabaseConnection,
    config: Config,
}

pub struct AppState {
    base_state: Arc<AppBaseState>,
    ssh_service: Arc<TargetSshService>,
    transfer_service: transfer::TransferService,
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
    let connection_pool = Arc::new(SshConnectionPool::new(
        app_base_state.db.clone(),
        app_base_state.config.check_server_key,
        app_base_state.config.max_connections_per_target as usize,
        app_base_state.config.max_channels_per_connection as usize,
    ));
    let ssh_service = Arc::new(TargetSshService::new(
        app_base_state.db.clone(),
        connection_pool.clone(),
    ));
    let transfer_service =
        transfer::TransferService::new(app_base_state.clone(), ssh_service.clone());
    transfer_service.init_pending_tasks().await.unwrap();

    let app_state = Arc::new(AppState {
        base_state: app_base_state.clone(),
        ssh_service: ssh_service.clone(),
        transfer_service,
    });

    let app = Router::new()
        .nest(
            "/api/ssh_connection",
            ssh_connection::router_builder(connection_pool.clone()),
        )
        .nest("/api/ssh", ssh::router_builder(ssh_service.clone()))
        .nest("/api/sftp", sftp::router_builder(app_state.clone()))
        .nest("/api/fs", fs::router_builder(app_base_state.clone()))
        .nest("/api/transfer", transfer::router_builder(app_state.clone()))
        .nest("/api/target", target::router_builder(app_state.clone()))
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
