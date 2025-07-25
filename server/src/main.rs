mod apis;
mod config;
mod consts;
mod entities;
mod migrations;
mod ssh_session_pool;

use std::sync::Arc;

use axum::{Router, http::StatusCode, routing::any};
use config::Config;
use sea_orm::{Database, DatabaseConnection};
use tracing_subscriber::{EnvFilter, FmtSubscriber};

use apis::{sftp, ssh, target};
use migrations::{Migrator, MigratorTrait};

use crate::ssh_session_pool::SshSessionPool;

struct AppState {
    db: DatabaseConnection,
    config: Config,
}

#[tokio::main]
async fn main() {
    let subscriber = FmtSubscriber::builder()
        // "engineioxide=debug,socketioxide=debug,info"
        .with_env_filter(EnvFilter::from_default_env())
        .finish();

    tracing::subscriber::set_global_default(subscriber).unwrap();

    println!("Starting server...");

    let config = Config::load_config().await.unwrap();

    let db = Database::connect("sqlite:target/db.sqlite?mode=rwc")
        .await
        .expect("Database connection failed");

    Migrator::up(&db, None).await.unwrap();

    let app_state = Arc::new(AppState { db, config });
    let session_pool = Arc::new(SshSessionPool::new(app_state.clone()));

    let app = Router::new()
        .nest(
            "/api/ssh",
            ssh::router_builder(app_state.clone(), session_pool.clone()),
        )
        .nest(
            "/api/sftp",
            sftp::router_builder(app_state.clone(), session_pool.clone()),
        )
        .nest("/api/target", target::router_builder(app_state.clone()))
        .fallback(any(|| async { (StatusCode::NOT_FOUND, "404 Not Found") }));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8080")
        .await
        .unwrap();

    println!("Listening on http://{}", listener.local_addr().unwrap());

    axum::serve(listener, app).await.unwrap();
}
