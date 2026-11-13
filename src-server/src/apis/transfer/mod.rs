mod batch;
mod directory;
pub mod dto;
pub mod handlers;
mod ranges;
mod runner;
mod service;
mod tree;

use std::sync::Arc;

use axum::{
    Router,
    routing::{delete, get, post},
};

use crate::AppState;

pub use dto::{
    CreateDownloadBatchPayload, CreateDownloadTaskPayload, CreateUploadBatchPayload,
    CreateUploadTaskPayload, TransferBatchResponse, TransferRangeSchema, TransferTaskCountResponse,
    TransferTaskResponse, TransferTreeNode, TransferTreeNodeType,
};
pub use handlers::{
    cancel_batch, cancel_directory, cancel_task, count_unfinished_tasks, create_download_batch,
    create_download_task, create_upload_batch, create_upload_task, delete_batch, delete_directory,
    delete_finished_history, delete_task, get_task, list_tasks, list_tree, pause_batch,
    pause_directory, pause_task, resume_batch, resume_directory, resume_task,
};
pub use ranges::TransferRange;
pub use service::TransferService;

pub(crate) fn router_builder(app_state: Arc<AppState>) -> Router {
    Router::new()
        .route("/upload", post(create_upload_task))
        .route("/download", post(create_download_task))
        .route("/batches/upload", post(create_upload_batch))
        .route("/batches/download", post(create_download_batch))
        .route("/batches/{id}", delete(delete_batch))
        .route("/batches/{id}/pause", post(pause_batch))
        .route("/batches/{id}/resume", post(resume_batch))
        .route("/batches/{id}/cancel", post(cancel_batch))
        .route("/history", delete(delete_finished_history))
        .route("/list", get(list_tasks))
        .route("/tree", get(list_tree))
        .route("/list/tree", get(list_tree))
        .route("/unfinished-count", get(count_unfinished_tasks))
        .route("/{id}", get(get_task).delete(delete_task))
        .route("/{id}/pause", post(pause_task))
        .route("/{id}/resume", post(resume_task))
        .route("/{id}/cancel", post(cancel_task))
        .route("/directories/{id}/pause", post(pause_directory))
        .route("/directories/{id}/resume", post(resume_directory))
        .route("/directories/{id}/cancel", post(cancel_directory))
        .route("/directories/{id}", delete(delete_directory))
        .with_state(app_state)
}
