pub mod dto;
pub mod handlers;
mod ranges;
mod runner;
mod service;
mod sftp_uri;

use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};

use crate::AppState;

pub use dto::{
    CreateDownloadTaskPayload, CreateUploadTaskPayload, TransferRangeSchema, TransferTaskResponse,
};
pub use handlers::{
    cancel_task, create_download_task, create_upload_task, delete_task, get_task, list_tasks,
    pause_task, resume_task,
};
pub use ranges::TransferRange;
pub use service::TransferService;

pub(crate) fn router_builder(app_state: Arc<AppState>) -> Router {
    Router::new()
        .route("/upload", post(create_upload_task))
        .route("/download", post(create_download_task))
        .route("/list", get(list_tasks))
        .route("/{id}", get(get_task).delete(delete_task))
        .route("/{id}/pause", post(pause_task))
        .route("/{id}/resume", post(resume_task))
        .route("/{id}/cancel", post(cancel_task))
        .with_state(app_state)
}
