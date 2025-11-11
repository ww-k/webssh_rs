use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};

use crate::{apis::handlers::ssh_connection, ssh_session_pool::SshSessionPool};

pub(crate) fn router_builder(session_pool: Arc<SshSessionPool>) -> Router {
    Router::new()
        .route("/list", get(ssh_connection::list::handler))
        .route("/expire", post(ssh_connection::expire::handler))
        .fallback(|| async { "not supported" })
        .with_state(session_pool)
}
