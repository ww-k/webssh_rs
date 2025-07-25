use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};

use super::handlers::sftp;
use crate::AppState;

pub(crate) fn router_builder(app_state: Arc<AppState>) -> Router {
    Router::new()
        .route("/ls", get(sftp::ls::handler))
        .route("/mkdir", post(sftp::mkdir::handler))
        .route("/stat", get(sftp::stat::handler))
        .route("/home", get(sftp::home::handler))
        .route("/cp", post(sftp::cp::handler))
        .route("/rename", post(sftp::rename::handler))
        .route("/rm", post(sftp::rm::handler))
        .route("/rm/rf", post(sftp::rm_rf::handler))
        .route("/upload", post(sftp::upload::handler))
        .route("/download", get(sftp::download::handler))
        .fallback(|| async { "not supported" })
        .with_state(app_state)
}
