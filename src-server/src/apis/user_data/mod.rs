pub mod dto;
pub mod handlers;
mod service;

use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};

use crate::AppState;

pub(crate) fn router_builder(app_state: Arc<AppState>) -> Router {
    Router::new()
        .route("/export", get(handlers::user_data_export))
        .route("/import", post(handlers::user_data_import))
        .fallback(|| async { "not supported" })
        .with_state(app_state)
}
