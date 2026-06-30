pub mod dto;
pub mod handlers;
mod service;

use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};

use crate::AppState;

pub use dto::SftpFile;
pub use handlers::{cp, download, home, ls, mkdir, rename, rm, rm_rf, stat, upload};
pub(crate) use service::{get_file_name, parse_file_uri};

pub(crate) fn router_builder(app_state: Arc<AppState>) -> Router {
    Router::new()
        .route("/ls", get(ls))
        .route("/mkdir", post(mkdir))
        .route("/stat", get(stat))
        .route("/home", get(home))
        .route("/cp", post(cp))
        .route("/rename", post(rename))
        .route("/rm", post(rm))
        .route("/rm/rf", post(rm_rf))
        .route("/upload", post(upload))
        .route("/download", get(download))
        .fallback(|| async { "not supported" })
        .with_state(app_state)
}
