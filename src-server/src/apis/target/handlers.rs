use std::sync::Arc;

use axum::{Json, extract::State};

use crate::{
    AppState,
    apis::{
        ApiErr, InternalErrorResponse, ValidJson,
        target::{
            dto::{TargetRemovePayload, TargetUpdatePayload},
            service,
        },
    },
    entities::target,
};

#[utoipa::path(
    get,
    path = "/api/target/list",
    tag = "target",
    summary = "获取 SSH 目标列表",
    operation_id = "target_list",
    responses(
        (status = 200, description = "成功获取 SSH 目标列表", body = [target::Model]),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn target_list(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<target::Model>>, ApiErr> {
    let targets = service::list(&state.db).await?;
    Ok(Json(targets))
}

#[utoipa::path(
    post,
    path = "/api/target/add",
    tag = "target",
    summary = "添加新的 SSH 目标",
    operation_id = "target_add",
    request_body = target::Model,
    responses(
        (status = 200, description = "成功添加 SSH 目标", body = target::Model),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn target_add(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<target::Model>,
) -> Result<Json<target::Model>, ApiErr> {
    let target = service::add(&state.db, payload).await?;
    Ok(Json(target))
}

#[utoipa::path(
    post,
    path = "/api/target/update",
    tag = "target",
    summary = "更新 SSH 目标",
    operation_id = "target_update",
    request_body = TargetUpdatePayload,
    responses(
        (status = 200, description = "成功更新 SSH 目标", body = target::Model),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn target_update(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<TargetUpdatePayload>,
) -> Result<Json<target::Model>, ApiErr> {
    let target = service::update(&state.ssh_service, payload).await?;
    Ok(Json(target))
}

#[utoipa::path(
    post,
    path = "/api/target/remove",
    tag = "target",
    summary = "删除 SSH 目标",
    operation_id = "target_remove",
    request_body = TargetRemovePayload,
    responses(
        (status = 200, description = "成功删除 SSH 目标"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn target_remove(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<TargetRemovePayload>,
) -> Result<(), ApiErr> {
    service::remove(&state.ssh_service, payload.id).await
}
