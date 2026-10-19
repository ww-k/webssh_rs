use std::sync::Arc;

use axum::{Json, extract::State};

use crate::{
    AppState,
    apis::{
        ApiErr, InternalErrorResponse, ValidJson,
        user_data::{
            dto::{UserDataExport, UserDataImportPayload, UserDataImportResult},
            service,
        },
    },
};

#[utoipa::path(
    get,
    path = "/api/user_data/export",
    tag = "user_data",
    operation_id = "user_data_export",
    responses(
        (status = 200, description = "导出用户数据", body = UserDataExport),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn user_data_export(
    State(state): State<Arc<AppState>>,
) -> Result<Json<UserDataExport>, ApiErr> {
    Ok(Json(service::export(&state.db).await?))
}

#[utoipa::path(
    post,
    path = "/api/user_data/import",
    tag = "user_data",
    operation_id = "user_data_import",
    request_body = UserDataImportPayload,
    responses(
        (status = 200, description = "导入用户数据", body = UserDataImportResult),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn user_data_import(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<UserDataImportPayload>,
) -> Result<Json<UserDataImportResult>, ApiErr> {
    Ok(Json(service::import(&state.db, payload).await?))
}
