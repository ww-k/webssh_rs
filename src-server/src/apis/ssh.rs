use std::sync::Arc;

use axum::{Router, routing::post};

use super::handlers::ssh;
use crate::ssh_session_pool::SshSessionPool;

pub(crate) fn router_builder(session_pool: Arc<SshSessionPool>) -> Router {
    Router::new()
        .nest(
            "/terminal",
            ssh::terminal::router_builder(session_pool.clone()),
        )
        .route("/exec", post(ssh::exec::handler))
        .fallback(|| async { "not supported" })
        .with_state(session_pool)
}
