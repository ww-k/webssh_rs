use std::sync::Arc;

use axum::{Json, extract::State};

use crate::apis::{ApiErr, InternalErrorResponse, ValidJson};

use super::{
    PortForwardManager,
    dto::{
        PortForwardInfo, PortForwardPayload, PortForwardRemovePayload, PortForwardTogglePayload,
        PortForwardUpdatePayload,
    },
};

#[utoipa::path(
    get,
    path = "/api/port_forward/list",
    tag = "port_forward",
    summary = "获取端口转发列表",
    responses((status = 200, body = [PortForwardInfo]), (status = 500, response = InternalErrorResponse))
)]
pub async fn list(State(manager): State<Arc<PortForwardManager>>) -> Json<Vec<PortForwardInfo>> {
    Json(manager.list().await)
}

#[utoipa::path(
    post,
    path = "/api/port_forward/create",
    tag = "port_forward",
    summary = "创建端口转发",
    request_body = PortForwardPayload,
    responses((status = 200, body = PortForwardInfo), (status = 500, response = InternalErrorResponse))
)]
pub async fn create(
    State(manager): State<Arc<PortForwardManager>>,
    ValidJson(payload): ValidJson<PortForwardPayload>,
) -> Result<Json<PortForwardInfo>, ApiErr> {
    Ok(Json(manager.create(payload).await?))
}

#[utoipa::path(
    post,
    path = "/api/port_forward/update",
    tag = "port_forward",
    summary = "编辑端口转发",
    request_body = PortForwardUpdatePayload,
    responses((status = 200, body = PortForwardInfo), (status = 500, response = InternalErrorResponse))
)]
pub async fn update(
    State(manager): State<Arc<PortForwardManager>>,
    ValidJson(payload): ValidJson<PortForwardUpdatePayload>,
) -> Result<Json<PortForwardInfo>, ApiErr> {
    Ok(Json(manager.update(payload).await?))
}

#[utoipa::path(
    post,
    path = "/api/port_forward/remove",
    tag = "port_forward",
    summary = "删除端口转发",
    request_body = PortForwardRemovePayload,
    responses((status = 200), (status = 500, response = InternalErrorResponse))
)]
pub async fn remove(
    State(manager): State<Arc<PortForwardManager>>,
    ValidJson(payload): ValidJson<PortForwardRemovePayload>,
) -> Result<(), ApiErr> {
    if manager.remove(&payload.id).await? {
        Ok(())
    } else {
        Err(ApiErr {
            code: crate::consts::services_err_code::ERR_CODE_PORT_FORWARD,
            message: "port forwarding entry not found".into(),
        })
    }
}

#[utoipa::path(
    post,
    path = "/api/port_forward/toggle",
    tag = "port_forward",
    summary = "启用或禁用端口转发",
    request_body = PortForwardTogglePayload,
    responses((status = 200, body = PortForwardInfo), (status = 500, response = InternalErrorResponse))
)]
pub async fn toggle(
    State(manager): State<Arc<PortForwardManager>>,
    ValidJson(payload): ValidJson<PortForwardTogglePayload>,
) -> Result<Json<PortForwardInfo>, ApiErr> {
    Ok(Json(manager.toggle(&payload.id, payload.enabled).await?))
}
