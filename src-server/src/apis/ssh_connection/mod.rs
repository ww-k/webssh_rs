pub mod dto;
pub mod handlers;
mod service;

use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};

use crate::ssh_session_pool::SshSessionPool;

pub(crate) use handlers::{expire, list};

pub(crate) fn router_builder(session_pool: Arc<SshSessionPool>) -> Router {
    Router::new()
        .route("/list", get(list))
        .route("/expire", post(expire))
        .fallback(|| async { "not supported" })
        .with_state(session_pool)
}
