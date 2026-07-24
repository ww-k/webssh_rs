pub mod dto;
pub mod handlers;
mod service;

use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};

use crate::AppBaseState;

pub use dto::FsFile;
pub use handlers::{cp, home, ls, mkdir, rename, rm, rm_rf, show_in_folder, stat};

pub(crate) fn router_builder(app_state: Arc<AppBaseState>) -> Router {
    Router::new()
        .route("/ls", get(ls))
        .route("/home", get(home))
        .route("/stat", get(stat))
        .route("/mkdir", post(mkdir))
        .route("/cp", post(cp))
        .route("/rename", post(rename))
        .route("/rm", post(rm))
        .route("/rm/rf", post(rm_rf))
        .route("/show-in-folder", post(show_in_folder))
        .with_state(app_state)
}
