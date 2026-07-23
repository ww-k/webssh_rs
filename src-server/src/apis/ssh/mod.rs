pub mod dto;
pub mod handlers;
mod service;

use std::sync::Arc;

use axum::{Router, routing::post};

use crate::target_ssh_service::TargetSshService;

pub(crate) use handlers::exec_handler;
pub use service::exec;

pub(crate) fn router_builder(ssh_service: Arc<TargetSshService>) -> Router {
    Router::new()
        .nest(
            "/terminal",
            handlers::terminal_router_builder(ssh_service.clone()),
        )
        .route("/exec", post(exec_handler))
        .fallback(|| async { "not supported" })
        .with_state(ssh_service)
}
