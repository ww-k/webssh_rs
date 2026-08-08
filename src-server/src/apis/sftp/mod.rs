pub mod dto;
pub mod handlers;
mod service;

use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};

use crate::AppState;

pub use dto::{SftpFile, SftpUserDir};
pub use handlers::{
    cp, download, ls, mkdir, rename, rm, rm_rf, stat, upload, user_dir_home, user_dirs,
};
pub(crate) use service::{discover_user_dirs, get_file_name, parse_file_uri};

pub(crate) fn router_builder(app_state: Arc<AppState>) -> Router {
    Router::new()
        .route("/ls", get(ls))
        .route("/mkdir", post(mkdir))
        .route("/stat", get(stat))
        .route("/user-dirs", get(user_dirs))
        .route("/user-dirs/home", get(user_dir_home))
        .route("/cp", post(cp))
        .route("/rename", post(rename))
        .route("/rm", post(rm))
        .route("/rm/rf", post(rm_rf))
        .route("/upload", post(upload))
        .route("/download", get(download))
        .fallback(|| async { "not supported" })
        .with_state(app_state)
}
