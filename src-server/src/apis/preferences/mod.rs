pub mod dto;
pub mod handlers;
mod service;

use std::sync::Arc;

use crate::AppState;
use axum::{Router, routing::get};

pub(crate) fn router_builder(app_state: Arc<AppState>) -> Router {
    Router::new()
        .route(
            "/api/preferences",
            get(handlers::get_preferences).put(handlers::put_preferences),
        )
        .with_state(app_state)
}
