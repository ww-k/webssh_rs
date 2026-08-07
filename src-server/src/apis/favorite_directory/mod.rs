pub mod dto;
pub mod handlers;
mod service;

use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};

use crate::AppBaseState;

pub(crate) fn router_builder(app_state: Arc<AppBaseState>) -> Router {
    Router::new()
        .route("/list", get(handlers::favorite_directory_list))
        .route("/add", post(handlers::favorite_directory_add))
        .route("/remove", post(handlers::favorite_directory_remove))
        .fallback(|| async { "not supported" })
        .with_state(app_state)
}
