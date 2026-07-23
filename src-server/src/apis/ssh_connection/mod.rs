pub mod dto;
pub mod handlers;
mod service;

use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};

use crate::ssh_connection_pool::SshConnectionPool;

pub(crate) use handlers::{expire, list};

pub(crate) fn router_builder(connection_pool: Arc<SshConnectionPool>) -> Router {
    Router::new()
        .route("/list", get(list))
        .route("/expire", post(expire))
        .fallback(|| async { "not supported" })
        .with_state(connection_pool)
}
