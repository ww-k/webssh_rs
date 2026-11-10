pub mod dto;
pub mod handlers;
mod service;

use std::sync::Arc;

use crate::AppState;
use axum::{Router, routing::get};

pub(crate) fn router_builder(app_state: Arc<AppState>) -> Router {
    Router::new()
        .route(
            "/api/app_state",
            get(handlers::get_app_state).put(handlers::put_app_state),
        )
        .with_state(app_state)
}
