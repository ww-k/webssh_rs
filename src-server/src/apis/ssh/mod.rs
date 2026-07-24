pub mod dto;
pub mod handlers;
mod service;

use std::sync::Arc;

use axum::{Router, routing::post};

use crate::ssh_connection_pool::SshConnectionPool;

pub(crate) use handlers::exec_handler;
pub use service::exec;

pub(crate) fn router_builder(connection_pool: Arc<SshConnectionPool>) -> Router {
    Router::new()
        .nest(
            "/terminal",
            handlers::terminal_router_builder(connection_pool.clone()),
        )
        .route("/exec", post(exec_handler))
        .fallback(|| async { "not supported" })
        .with_state(connection_pool)
}
