use std::sync::Arc;

use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use sea_orm::{ActiveModelTrait, ActiveValue::Set, DatabaseConnection, EntityTrait};
use serde::Deserialize;

use crate::{AppBaseState, entities::target, map_db_err};
use crate::{consts::services_err_code::ERR_CODE_DB_ERR, entities::target::TargetAuthMethod};

use super::{ApiErr, ValidJson};

// target service
// 1. get a list of binded target
// 2. add a new target
// 3. update a target
// 4. remove a target

pub(crate) fn router_builder(app_state: Arc<AppBaseState>) -> Router {
    Router::new()
        .route("/list", get(target_list))
        .route("/add", post(target_add))
        .route("/update", post(target_update))
        .route("/remove", post(target_remove))
        .fallback(|| async { "not supported" })
        .with_state(app_state)
}

#[utoipa::path(
    get,
    path = "/api/target/list",
    tag = "target",
    summary = "获取 SSH 目标列表",
    operation_id = "target_list",
    responses(
        (status = 200, description = "成功获取 SSH 目标列表", body = [target::Model]),
        (status = 500, description = "服务器内部错误", body = ApiErr)
    )
)]
async fn target_list(
    State(state): State<Arc<AppBaseState>>,
) -> Result<Json<Vec<target::Model>>, ApiErr> {
    let targets = map_db_err!(target::Entity::find().all(&state.db).await)?;
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
        (status = 500, description = "服务器内部错误", body = ApiErr)
    )
)]
async fn target_add(
    State(state): State<Arc<AppBaseState>>,
    ValidJson(payload): ValidJson<target::Model>,
) -> Result<Json<target::Model>, ApiErr> {
    let mut active_model = target::ActiveModel::from(payload);
    active_model.id = sea_orm::ActiveValue::NotSet;

    let target = map_db_err!(active_model.insert(&state.db).await)?;
    Ok(Json(target))
}

#[derive(Deserialize, Debug, utoipa::ToSchema)]
pub struct TargetUpdatePayload {
    /// 目标 ID
    pub id: i32,
    /// SSH 目标主机地址
    pub host: String,
    /// SSH 端口号
    pub port: Option<u16>,
    /// 认证方式
    pub method: TargetAuthMethod,
    /// SSH 用户名
    pub user: String,
    /// 私钥内容
    pub key: Option<String>,
    /// 密码
    pub password: Option<String>,
    /// 操作系统类型
    pub system: Option<String>,
}

impl From<TargetUpdatePayload> for target::ActiveModel {
    fn from(p: TargetUpdatePayload) -> Self {
        target::ActiveModel {
            id: Set(p.id),
            host: Set(p.host),
            port: Set(p.port),
            method: Set(p.method),
            user: Set(p.user),
            key: Set(p.key),
            password: Set(p.password),
            system: Set(p.system),
        }
    }
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
        (status = 500, description = "服务器内部错误", body = ApiErr)
    )
)]
async fn target_update(
    State(state): State<Arc<AppBaseState>>,
    ValidJson(payload): ValidJson<TargetUpdatePayload>,
) -> Result<Json<target::Model>, ApiErr> {
    let active_model = target::ActiveModel::from(payload);

    let target = map_db_err!(active_model.update(&state.db).await)?;
    Ok(Json(target))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct TargetRemovePayload {
    /// 要删除的目标 ID
    pub id: i32,
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
        (status = 500, description = "服务器内部错误", body = ApiErr)
    )
)]
async fn target_remove(
    State(state): State<Arc<AppBaseState>>,
    ValidJson(payload): ValidJson<TargetRemovePayload>,
) -> Result<(), ApiErr> {
    map_db_err!(
        target::Entity::delete_by_id(payload.id)
            .exec(&state.db)
            .await
    )?;
    Ok(())
}

pub async fn get_target_by_id(
    db: &DatabaseConnection,
    target_id: i32,
) -> anyhow::Result<target::Model> {
    let result = target::Entity::find_by_id(target_id)
        .one(db)
        .await
        .map_err(|db_err| anyhow::format_err!("Failed to get target {:?}", db_err))?;

    if result.is_none() {
        anyhow::bail!("no target found");
    }

    Ok(result.unwrap())
}
