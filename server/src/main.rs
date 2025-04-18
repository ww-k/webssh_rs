use std::sync::Arc;

use axum::{Router, http::StatusCode, routing::any};
use sea_orm::Database;
// use tower_http::services::ServeDir;
use tracing::info;
use tracing_subscriber::{EnvFilter, FmtSubscriber};

use svc_target::*;
use svc_term::*;

mod entities;
mod svc_target;
mod svc_term;

struct AppState {
    db: sea_orm::DatabaseConnection,
}

#[tokio::main]
async fn main() {
    let subscriber = FmtSubscriber::builder()
        // "engineioxide=debug,socketioxide=debug,info"
        .with_env_filter(EnvFilter::from_default_env())
        .finish();

    tracing::subscriber::set_global_default(subscriber).unwrap();

    println!("Starting server...");

    let db = Database::connect("sqlite::memory:")
        .await
        .expect("Database connection failed");

    let app_state = Arc::new(AppState { db });

    let app = Router::new()
        //.with_state(app_state.clone())
        .nest("/api/term", svc_term_router_builder(app_state.clone()))
        .nest("/api/target", svc_target_router_builder(app_state.clone()))
        .fallback(any(|| async { (StatusCode::NOT_FOUND, "404 Not Found") }));
    //.fallback_service(ServeDir::new("../client"));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8080")
        .await
        .unwrap();

    println!("Listening on http://{}", listener.local_addr().unwrap());

    axum::serve(listener, app).await.unwrap();
}
