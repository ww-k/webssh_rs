mod batch;
mod directory;
pub mod dto;
pub mod handlers;
mod ranges;
mod runner;
mod service;

use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};

use crate::AppState;

pub use dto::{
    BatchItemsResponse, CreateDownloadBatchPayload, CreateDownloadTaskPayload,
    CreateUploadBatchPayload, CreateUploadTaskPayload, TransferBatchResponse, TransferRangeSchema,
    TransferTaskResponse,
};
pub use handlers::{
    cancel_batch, cancel_task, create_download_batch, create_download_task, create_upload_batch,
    create_upload_task, delete_batch, delete_task, get_batch, get_batch_items, get_task,
    list_batches, list_tasks, pause_batch, pause_task, resume_batch, resume_task,
};
pub use ranges::TransferRange;
pub use service::TransferService;

pub(crate) fn router_builder(app_state: Arc<AppState>) -> Router {
    Router::new()
        .route("/upload", post(create_upload_task))
        .route("/download", post(create_download_task))
        .route("/batches/upload", post(create_upload_batch))
        .route("/batches/download", post(create_download_batch))
        .route("/batches", get(list_batches))
        .route("/batches/{id}", get(get_batch).delete(delete_batch))
        .route("/batches/{id}/items", get(get_batch_items))
        .route("/batches/{id}/pause", post(pause_batch))
        .route("/batches/{id}/resume", post(resume_batch))
        .route("/batches/{id}/cancel", post(cancel_batch))
        .route("/list", get(list_tasks))
        .route("/{id}", get(get_task).delete(delete_task))
        .route("/{id}/pause", post(pause_task))
        .route("/{id}/resume", post(resume_task))
        .route("/{id}/cancel", post(cancel_task))
        .with_state(app_state)
}
