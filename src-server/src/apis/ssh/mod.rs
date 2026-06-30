pub mod dto;
pub mod handlers;
mod service;

use std::sync::Arc;

use axum::{Router, routing::post};

use crate::ssh_session_pool::SshSessionPool;

pub(crate) use handlers::exec_handler;
pub use service::exec;

pub(crate) fn router_builder(session_pool: Arc<SshSessionPool>) -> Router {
    Router::new()
        .nest(
            "/terminal",
            handlers::terminal_router_builder(session_pool.clone()),
        )
        .route("/exec", post(exec_handler))
        .fallback(|| async { "not supported" })
        .with_state(session_pool)
}
