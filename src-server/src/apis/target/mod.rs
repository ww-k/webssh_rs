pub mod dto;
pub mod handlers;
mod service;

#[cfg(test)]
pub(crate) use service::{remove as remove_for_test, update as update_for_test};

use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};

use crate::AppState;

pub use dto::{TargetRemovePayload, TargetUpdatePayload};
pub use handlers::{target_add, target_list, target_remove, target_update};
pub(crate) fn router_builder(app_state: Arc<AppState>) -> Router {
    Router::new()
        .route("/list", get(target_list))
        .route("/add", post(target_add))
        .route("/update", post(target_update))
        .route("/remove", post(target_remove))
        .fallback(|| async { "not supported" })
        .with_state(app_state)
}
