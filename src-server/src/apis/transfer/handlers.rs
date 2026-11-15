use std::sync::Arc;

use axum::{
    Json,
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{HeaderMap, StatusCode, header},
};
use serde::Deserialize;
use tracing::info;

use crate::{
    AppState,
    apis::{ApiErr, InternalErrorResponse},
    entities::transfer_task::Model as TransferTaskModel,
};

use super::tree::build_transfer_tree;
use super::{
    dto::{
        CreateClientUploadPayload, CreateDownloadBatchPayload, CreateDownloadTaskPayload,
        CreateUploadBatchPayload, CreateUploadTaskPayload, TransferBatchResponse,
        TransferRangeSchema, TransferTaskCountResponse, TransferTaskResponse, TransferTreeNode,
    },
    ranges::{invalid_task, ranges_from_json},
};
use crate::apis::sftp::{
    dto::{ContentRange, SftpUploadResponse},
    handlers::upload_to_sftp,
};

#[utoipa::path(
    post,
    path = "/api/transfer/client-upload",
    tag = "transfer",
    summary = "创建浏览器文件上传任务",
    request_body = CreateClientUploadPayload,
    responses(
        (status = 200, description = "成功创建上传任务", body = TransferTaskResponse),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn create_client_upload(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateClientUploadPayload>,
) -> Result<Json<TransferTaskResponse>, ApiErr> {
    let task = state.transfer_service.create_client_upload(payload).await?;
    Ok(Json(task.into_response()?))
}

/// Accept a browser chunk, write it to SFTP, then persist the completed range.
#[utoipa::path(
    put,
    path = "/api/transfer/client-upload/{id}",
    tag = "transfer",
    params(("id" = String, Path, description = "上传任务 ID")),
    request_body(
        content = Vec<u8>,
        content_type = "application/octet-stream"
    ),
    responses(
        (status = 200, description = "分片上传成功", body = SftpUploadResponse),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn client_upload_chunk(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    body: Body,
) -> Result<Json<SftpUploadResponse>, ApiErr> {
    let task = state.transfer_service.get_task_model(&id).await?;
    if task.local_path.is_some()
        || task.r#type != crate::entities::transfer_task::TransferTaskType::Upload
    {
        return Err(invalid_task("task is not a client upload"));
    }
    if !matches!(
        task.status,
        crate::entities::transfer_task::TransferTaskStatus::Run
            | crate::entities::transfer_task::TransferTaskStatus::Wait
            | crate::entities::transfer_task::TransferTaskStatus::Success
    ) {
        return Err(invalid_task("client upload task is not running"));
    }

    let range = ContentRange::from_header_value(headers.get(header::CONTENT_RANGE))
        .ok_or_else(|| invalid_task("content-range is required"))?;
    if range.total != task.total as usize || range.end >= range.total {
        return Err(invalid_task("content-range does not match task"));
    }
    let target_uri = task
        .target_uri
        .as_deref()
        .ok_or_else(|| invalid_task("client upload target is missing"))?;
    let response = upload_to_sftp(state.clone(), target_uri, headers, body).await?;
    state
        .transfer_service
        .mark_client_range_done(&id, [range.start as i64, range.end as i64])
        .await?;
    Ok(Json(response))
}

#[utoipa::path(
    post,
    path = "/api/transfer/client-upload/{id}/complete",
    tag = "transfer",
    params(("id" = String, Path, description = "上传任务 ID")),
    responses(
        (status = 200, description = "上传任务完成", body = TransferTaskResponse),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn complete_client_upload(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<TransferTaskResponse>, ApiErr> {
    let task = state.transfer_service.complete_client_upload(&id).await?;
    Ok(Json(task.into_response()?))
}

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

pub async fn create_upload_batch(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateUploadBatchPayload>,
) -> Result<Json<TransferBatchResponse>, ApiErr> {
    Ok(Json(
        state.transfer_service.create_upload_batch(payload).await?,
    ))
}

pub async fn create_download_batch(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateDownloadBatchPayload>,
) -> Result<Json<TransferBatchResponse>, ApiErr> {
    Ok(Json(
        state
            .transfer_service
            .create_download_batch(payload)
            .await?,
    ))
}

pub async fn pause_batch(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<TransferBatchResponse>, ApiErr> {
    Ok(Json(state.transfer_service.pause_batch(&id).await?.into()))
}
pub async fn resume_batch(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<TransferBatchResponse>, ApiErr> {
    Ok(Json(state.transfer_service.resume_batch(&id).await?.into()))
}
pub async fn cancel_batch(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<TransferBatchResponse>, ApiErr> {
    Ok(Json(state.transfer_service.cancel_batch(&id).await?.into()))
}
pub async fn delete_batch(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<(), ApiErr> {
    state.transfer_service.delete_batch(&id).await
}

#[utoipa::path(
    delete,
    path = "/api/transfer/history",
    tag = "transfer",
    summary = "删除所有结束状态的传输历史",
    responses(
        (status = 204, description = "成功删除所有结束状态的传输历史"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn delete_finished_history(
    State(state): State<Arc<AppState>>,
) -> Result<StatusCode, ApiErr> {
    state.transfer_service.delete_finished_history().await?;
    Ok(StatusCode::NO_CONTENT)
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
    params(("batch_id" = Option<String>, Query, description = "按批次 ID 筛选任务")),
    responses(
        (status = 200, description = "成功查询传输任务列表", body = Vec<TransferTaskResponse>),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn list_tasks(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ListTasksQuery>,
) -> Result<Json<Vec<TransferTaskResponse>>, ApiErr> {
    let tasks = state
        .transfer_service
        .list_tasks(query.batch_id.as_deref())
        .await?;
    let response = tasks
        .into_iter()
        .map(IntoTransferResponse::into_response)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(response))
}

#[utoipa::path(
    get,
    path = "/api/transfer/tree",
    tag = "transfer",
    summary = "查询树状传输任务列表",
    params(("batch_id" = Option<String>, Query, description = "按批次 ID 筛选任务")),
    responses(
        (status = 200, description = "成功查询树状传输任务列表", body = Vec<TransferTreeNode>),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn list_tree(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ListTasksQuery>,
) -> Result<Json<Vec<TransferTreeNode>>, ApiErr> {
    let tasks = state
        .transfer_service
        .list_tasks(query.batch_id.as_deref())
        .await?;
    Ok(Json(build_transfer_tree(tasks)?))
}

#[utoipa::path(
    get,
    path = "/api/transfer/unfinished-count",
    tag = "transfer",
    summary = "查询未完成传输任务数量",
    params(("created_after" = Option<i64>, Query, description = "统计此时间之后创建的任务")),
    responses(
        (status = 200, description = "未完成传输任务数量", body = TransferTaskCountResponse),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn count_unfinished_tasks(
    State(state): State<Arc<AppState>>,
    Query(query): Query<UnfinishedCountQuery>,
) -> Result<Json<TransferTaskCountResponse>, ApiErr> {
    let count = state
        .transfer_service
        .count_unfinished_tasks(query.created_after)
        .await?;
    Ok(Json(TransferTaskCountResponse { count }))
}

#[derive(Debug, Deserialize)]
pub struct ListTasksQuery {
    pub batch_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UnfinishedCountQuery {
    #[serde(alias = "createdAfter")]
    pub created_after: Option<i64>,
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

pub async fn pause_directory(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<TransferBatchResponse>, ApiErr> {
    Ok(Json(state.transfer_service.pause_directory(&id).await?))
}

pub async fn resume_directory(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<TransferBatchResponse>, ApiErr> {
    Ok(Json(state.transfer_service.resume_directory(&id).await?))
}

pub async fn cancel_directory(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<TransferBatchResponse>, ApiErr> {
    Ok(Json(state.transfer_service.cancel_directory(&id).await?))
}

pub async fn delete_directory(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<(), ApiErr> {
    state.transfer_service.delete_directory(&id).await
}

pub(crate) trait IntoTransferResponse {
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
            kind: self.kind,
            status: self.status,
            local_path: self.local_path,
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
            batch_id: self.batch_id,
            parent_id: self.parent_id,
            relative_path: self.relative_path,
            conflict_policy: self.conflict_policy,
            all: self.all,
        })
    }
}
