pub mod dto;
pub mod handlers;
mod service;

use std::sync::Arc;

use axum::{Router, routing::post};

use crate::AppState;

pub(crate) fn router_builder(app_state: Arc<AppState>) -> Router {
    Router::new()
        .route("/export", post(handlers::user_data_export))
        .route("/import", post(handlers::user_data_import))
        .route("/import/url", post(handlers::user_data_import_url))
        .fallback(|| async { "not supported" })
        .with_state(app_state)
}
