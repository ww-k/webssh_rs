use axum::Router;
use tower_http::services::ServeDir;
use tracing::info;
use tracing_subscriber::{EnvFilter, FmtSubscriber};

use svc_connection::*;
use svc_term::*;

mod svc_connection;
mod svc_term;

#[tokio::main]
async fn main() {
    let subscriber = FmtSubscriber::builder()
        // "engineioxide=debug,socketioxide=debug,info"
        .with_env_filter(EnvFilter::from_default_env())
        .finish();

    tracing::subscriber::set_global_default(subscriber).unwrap();

    info!("Starting server...");

    let app = Router::new()
        .nest("/api/term", svc_term_router_builder())
        .nest("/api/connection", svc_connection_router_builder())
        .fallback_service(ServeDir::new("../client"));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8080")
        .await
        .unwrap();

    info!("Listening on http://{}", listener.local_addr().unwrap());

    axum::serve(listener, app).await.unwrap();
}
