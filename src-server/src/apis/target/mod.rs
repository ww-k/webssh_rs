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

pub use dto::{TargetRemovePayload, TargetReorderPayload, TargetUpdatePayload};
pub use handlers::{target_add, target_list, target_remove, target_reorder, target_update};
pub(crate) fn router_builder(app_state: Arc<AppState>) -> Router {
    Router::new()
        .route("/list", get(target_list))
        .route("/add", post(target_add))
        .route("/update", post(target_update))
        .route("/remove", post(target_remove))
        .route("/reorder", post(target_reorder))
        .fallback(|| async { "not supported" })
        .with_state(app_state)
}
