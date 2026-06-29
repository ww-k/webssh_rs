use std::sync::Arc;

use axum::{
    Json,
    extract::{Path as AxumPath, State},
};
use tracing::info;

use crate::{
    AppState,
    apis::{ApiErr, InternalErrorResponse},
    entities::transfer_task::Model as TransferTaskModel,
};

use super::{
    dto::{
        CreateDownloadTaskPayload, CreateUploadTaskPayload, TransferRangeSchema,
        TransferTaskResponse,
    },
    ranges::ranges_from_json,
};

#[utoipa::path(
    post,
    path = "/api/transfer/upload",
    tag = "transfer",
    summary = "创建上传任务",
    request_body = CreateUploadTaskPayload,
    responses(
        (status = 200, description = "成功创建上传任务", body = TransferTaskResponse),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn create_upload_task(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateUploadTaskPayload>,
) -> Result<Json<TransferTaskResponse>, ApiErr> {
    info!("@transfer_upload {:?}", payload);
    let task = state.transfer_service.create_upload(payload).await?;
    Ok(Json(task.into_response()?))
}

#[utoipa::path(
    post,
    path = "/api/transfer/download",
    tag = "transfer",
    summary = "创建下载任务",
    request_body = CreateDownloadTaskPayload,
    responses(
        (status = 200, description = "成功创建下载任务", body = TransferTaskResponse),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn create_download_task(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateDownloadTaskPayload>,
) -> Result<Json<TransferTaskResponse>, ApiErr> {
    info!("@transfer_download {:?}", payload);
    let task = state.transfer_service.create_download(payload).await?;
    Ok(Json(task.into_response()?))
}

#[utoipa::path(
    get,
    path = "/api/transfer/{id}",
    tag = "transfer",
    summary = "查询传输任务",
    params(("id" = String, Path, description = "任务 ID")),
    responses(
        (status = 200, description = "成功查询传输任务", body = TransferTaskResponse),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn get_task(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<TransferTaskResponse>, ApiErr> {
    let task = state.transfer_service.get_task_model(&id).await?;
    Ok(Json(task.into_response()?))
}

#[utoipa::path(
    get,
    path = "/api/transfer/list",
    tag = "transfer",
    summary = "查询传输任务列表",
    responses(
        (status = 200, description = "成功查询传输任务列表", body = Vec<TransferTaskResponse>),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn list_tasks(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<TransferTaskResponse>>, ApiErr> {
    let tasks = state.transfer_service.list_tasks().await?;
    let response = tasks
        .into_iter()
        .map(IntoTransferResponse::into_response)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(response))
}

#[utoipa::path(
    post,
    path = "/api/transfer/{id}/pause",
    tag = "transfer",
    summary = "暂停传输任务",
    params(("id" = String, Path, description = "任务 ID")),
    responses(
        (status = 200, description = "成功暂停传输任务", body = TransferTaskResponse),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn pause_task(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<TransferTaskResponse>, ApiErr> {
    let task = state.transfer_service.pause_task(&id).await?;
    Ok(Json(task.into_response()?))
}

#[utoipa::path(
    post,
    path = "/api/transfer/{id}/resume",
    tag = "transfer",
    summary = "恢复传输任务",
    params(("id" = String, Path, description = "任务 ID")),
    responses(
        (status = 200, description = "成功恢复传输任务", body = TransferTaskResponse),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn resume_task(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<TransferTaskResponse>, ApiErr> {
    let task = state.transfer_service.resume_task(&id).await?;
    Ok(Json(task.into_response()?))
}

#[utoipa::path(
    post,
    path = "/api/transfer/{id}/cancel",
    tag = "transfer",
    summary = "取消传输任务",
    params(("id" = String, Path, description = "任务 ID")),
    responses(
        (status = 200, description = "成功取消传输任务", body = TransferTaskResponse),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn cancel_task(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<TransferTaskResponse>, ApiErr> {
    let task = state.transfer_service.cancel_task(&id).await?;
    Ok(Json(task.into_response()?))
}

#[utoipa::path(
    delete,
    path = "/api/transfer/{id}",
    tag = "transfer",
    summary = "删除传输任务",
    params(("id" = String, Path, description = "任务 ID")),
    responses(
        (status = 200, description = "成功删除传输任务"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn delete_task(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<(), ApiErr> {
    state.transfer_service.delete_task(&id).await
}

trait IntoTransferResponse {
    fn into_response(self) -> Result<TransferTaskResponse, ApiErr>;
}

impl IntoTransferResponse for TransferTaskModel {
    fn into_response(self) -> Result<TransferTaskResponse, ApiErr> {
        Ok(TransferTaskResponse {
            ranges: ranges_from_json(&self.ranges)?
                .into_iter()
                .map(|[start, end]| TransferRangeSchema(start, end))
                .collect(),
            id: self.id,
            r#type: self.r#type,
            status: self.status,
            local_path: self.local_path,
            source_uri: self.source_uri,
            target_uri: self.target_uri,
            target_id: self.target_id,
            name: self.name,
            loaded: self.loaded,
            total: self.total,
            percent: self.percent,
            speed: self.speed,
            estimated_time: self.estimated_time,
            fail_reason: self.fail_reason,
            created_at: self.created_at,
            updated_at: self.updated_at,
            ended_at: self.ended_at,
        })
    }
}
