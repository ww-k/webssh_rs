use std::sync::Arc;

use axum::{Json, extract::State};

use crate::{
    AppState,
    apis::{
        ApiErr, InternalErrorResponse, ValidJson,
        user_data::{
            dto::{
                UserDataExportPayload, UserDataImportPayload, UserDataImportResult,
                UserDataImportUrlPayload,
            },
            service,
        },
    },
};

#[utoipa::path(
    post,
    path = "/api/user_data/export",
    tag = "user_data",
    operation_id = "user_data_export",
    request_body = UserDataExportPayload,
    responses(
        (status = 200, description = "导出用户数据", body = serde_json::Value),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn user_data_export(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<UserDataExportPayload>,
) -> Result<Json<serde_json::Value>, ApiErr> {
    Ok(Json(service::export(&state.db, payload).await?))
}

#[utoipa::path(
    post,
    path = "/api/user_data/import",
    tag = "user_data",
    operation_id = "user_data_import",
    request_body = UserDataImportPayload,
    responses(
        (status = 200, description = "解密并导入用户数据", body = UserDataImportResult),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn user_data_import(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<UserDataImportPayload>,
) -> Result<Json<UserDataImportResult>, ApiErr> {
    Ok(Json(service::import(&state.db, payload).await?))
}

#[utoipa::path(
    post,
    path = "/api/user_data/import/url",
    tag = "user_data",
    operation_id = "user_data_import_url",
    request_body = UserDataImportUrlPayload,
    responses(
        (status = 200, description = "从 URL 获取并导入用户数据", body = UserDataImportResult),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn user_data_import_url(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<UserDataImportUrlPayload>,
) -> Result<Json<UserDataImportResult>, ApiErr> {
    Ok(Json(service::import_from_url(&state.db, payload).await?))
}
