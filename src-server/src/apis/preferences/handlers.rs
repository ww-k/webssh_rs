use crate::{
    AppState,
    apis::{
        ApiErr, InternalErrorResponse, ValidJson,
        preferences::{dto::Preferences, service},
    },
};
use axum::{Json, extract::State};
use std::sync::Arc;

#[utoipa::path(get, path = "/api/app_state", tag = "app_state", operation_id = "get_app_state", responses((status = 200, body = Option<Preferences>), (status = 500, response = InternalErrorResponse)))]
pub async fn get_app_state(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Option<Preferences>>, ApiErr> {
    Ok(Json(service::get(&state.db).await?))
}

#[utoipa::path(put, path = "/api/app_state", tag = "app_state", operation_id = "put_app_state", request_body = Preferences, responses((status = 200, body = Preferences), (status = 500, response = InternalErrorResponse)))]
pub async fn put_app_state(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<Preferences>,
) -> Result<Json<Preferences>, ApiErr> {
    service::save(&state.db, payload.clone()).await?;
    Ok(Json(payload))
}
