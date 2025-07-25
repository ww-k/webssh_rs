use std::sync::Arc;

use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use sea_orm::{ActiveModelTrait, ActiveValue::Set, DatabaseConnection, EntityTrait};
use serde::Deserialize;

use crate::{AppState, entities::target, map_db_err};
use crate::{consts::services_err_code::ERR_CODE_DB_ERR, entities::target::TargetAuthMethod};

use super::{ApiErr, ValidJson};

// target service
// 1. get a list of binded target
// 2. add a new target
// 3. update a target
// 4. remove a target

pub(crate) fn router_builder(app_state: Arc<AppState>) -> Router {
    Router::new()
        .route("/list", get(target_list))
        .route("/add", post(target_add))
        .route("/update", post(target_update))
        .route("/remove", post(target_remove))
        .fallback(|| async { "not supported" })
        .with_state(app_state)
}

async fn target_list(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<target::Model>>, ApiErr> {
    let targets = map_db_err!(target::Entity::find().all(&state.db).await)?;
    Ok(Json(targets))
}

async fn target_add(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<target::Model>,
) -> Result<Json<target::Model>, ApiErr> {
    let mut active_model = target::ActiveModel::from(payload);
    active_model.id = sea_orm::ActiveValue::NotSet;

    let target = map_db_err!(active_model.insert(&state.db).await)?;
    Ok(Json(target))
}

#[derive(Deserialize, Debug)]
struct TargetUpdatePayload {
    id: i32,
    host: String,
    port: Option<u16>,
    method: TargetAuthMethod,
    user: String,
    key: Option<String>,
    password: Option<String>,
    system: Option<String>,
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

async fn target_update(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<TargetUpdatePayload>,
) -> Result<Json<target::Model>, ApiErr> {
    let active_model = target::ActiveModel::from(payload);

    let target = map_db_err!(active_model.update(&state.db).await)?;
    Ok(Json(target))
}

#[derive(Deserialize)]
struct TargetRemovePayload {
    id: i32,
}

async fn target_remove(
    State(state): State<Arc<AppState>>,
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
