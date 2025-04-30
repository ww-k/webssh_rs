use std::sync::Arc;

use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use sea_orm::{ActiveModelTrait, EntityTrait};
use serde::Deserialize;

use crate::{AppState, entities::target};

// target service
// 1. get a list of binded target
// 2. add a new target
// 3. remove a target

pub(crate) fn svc_target_router_builder(app_state: Arc<AppState>) -> Router {
    Router::new()
        .route("/list", get(target_list))
        .route("/add", post(target_add))
        .route("/remove", post(target_remove))
        .fallback(|| async { "not supported" })
        .with_state(app_state)
}

#[derive(Deserialize)]
struct TargetRemovePayload {
    id: i32,
}

async fn target_list(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<target::Model>>, String> {
    match target::Entity::find().all(&state.db).await {
        Ok(targets) => Ok(Json(targets)),
        Err(e) => Err(format!("Failed to fetch targets: {}", e)),
    }
}

async fn target_add(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<target::Model>,
) -> Result<Json<target::Model>, String> {
    let mut active_model = target::ActiveModel::from(payload);
    active_model.id = sea_orm::ActiveValue::NotSet;

    match active_model.insert(&state.db).await {
        Ok(target) => Ok(Json(target)),
        Err(e) => Err(format!("Failed to add target: {}", e)),
    }
}

async fn target_remove(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<TargetRemovePayload>,
) -> Result<String, String> {
    match target::Entity::delete_by_id(payload.id)
        .exec(&state.db)
        .await
    {
        Ok(_) => Ok(format!("")),
        Err(e) => Err(format!("Failed to remove target: {}", e)),
    }
}
