use std::sync::Arc;

use axum::{Json, extract::Query, extract::State};

use crate::{
    AppState,
    apis::{
        ApiErr, InternalErrorResponse, ValidJson,
        favorite_directory::{
            dto::{
                FavoriteDirectoryAddPayload, FavoriteDirectoryListQuery,
                FavoriteDirectoryRemovePayload,
            },
            service,
        },
    },
    entities::favorite_directory,
};

#[utoipa::path(
    get,
    path = "/api/favorite_directory/list",
    tag = "favorite_directory",
    summary = "获取收藏目录列表",
    operation_id = "favorite_directory_list",
    params(FavoriteDirectoryListQuery),
    responses(
        (status = 200, description = "成功获取收藏目录列表", body = [favorite_directory::Model]),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn favorite_directory_list(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<FavoriteDirectoryListQuery>,
) -> Result<Json<Vec<favorite_directory::Model>>, ApiErr> {
    Ok(Json(
        service::list(&state.db, &state.connection_pool, payload.target_id).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/favorite_directory/add",
    tag = "favorite_directory",
    summary = "添加收藏目录",
    operation_id = "favorite_directory_add",
    request_body = FavoriteDirectoryAddPayload,
    responses(
        (status = 200, description = "成功添加收藏目录", body = favorite_directory::Model),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn favorite_directory_add(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<FavoriteDirectoryAddPayload>,
) -> Result<Json<favorite_directory::Model>, ApiErr> {
    Ok(Json(service::add(&state.db, payload).await?))
}

#[utoipa::path(
    post,
    path = "/api/favorite_directory/remove",
    tag = "favorite_directory",
    summary = "取消收藏目录",
    operation_id = "favorite_directory_remove",
    request_body = FavoriteDirectoryRemovePayload,
    responses(
        (status = 200, description = "成功取消收藏目录"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn favorite_directory_remove(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<FavoriteDirectoryRemovePayload>,
) -> Result<(), ApiErr> {
    service::remove(&state.db, payload.target_id, &payload.path).await
}
