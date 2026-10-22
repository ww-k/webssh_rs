use std::sync::Arc;

use axum::{Json, extract::State};

use crate::{
    AppState,
    apis::{
        ApiErr, InternalErrorResponse, ValidJson,
        ssh_known_host::{dto::SshKnownHostRemovePayload, service},
    },
    entities::ssh_known_host,
};

#[utoipa::path(
    get,
    path = "/api/ssh_known_host/list",
    tag = "ssh_known_host",
    summary = "获取 SSH 主机密钥列表",
    operation_id = "ssh_known_host_list",
    responses(
        (status = 200, description = "成功获取 SSH 主机密钥列表", body = [ssh_known_host::Model]),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn list(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<ssh_known_host::Model>>, ApiErr> {
    Ok(Json(service::list(&state.db).await?))
}

#[utoipa::path(
    post,
    path = "/api/ssh_known_host/remove",
    tag = "ssh_known_host",
    summary = "删除 SSH 主机密钥",
    operation_id = "ssh_known_host_remove",
    request_body = SshKnownHostRemovePayload,
    responses(
        (status = 200, description = "成功删除 SSH 主机密钥"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn remove(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<SshKnownHostRemovePayload>,
) -> Result<(), ApiErr> {
    service::remove(&state.db, payload.id).await
}
