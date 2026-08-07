use std::sync::Arc;

use axum::{Json, extract::Query, extract::State};

use crate::{
    AppBaseState,
    apis::{
        ApiErr, InternalErrorResponse, ValidJson,
        favorite::{
            dto::{FavoriteAddPayload, FavoriteListQuery, FavoriteRemovePayload},
            service,
        },
    },
    entities::favorite_directory,
};

#[utoipa::path(
    get,
    path = "/api/favorite/list",
    tag = "favorite",
    summary = "获取收藏列表",
    operation_id = "favorite_list",
    params(FavoriteListQuery),
    responses(
        (status = 200, description = "成功获取收藏列表", body = [favorite_directory::Model]),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn favorite_list(
    State(state): State<Arc<AppBaseState>>,
    Query(payload): Query<FavoriteListQuery>,
) -> Result<Json<Vec<favorite_directory::Model>>, ApiErr> {
    Ok(Json(service::list(&state.db, payload.target_id).await?))
}

#[utoipa::path(
    post,
    path = "/api/favorite/add",
    tag = "favorite",
    summary = "添加收藏",
    operation_id = "favorite_add",
    request_body = FavoriteAddPayload,
    responses(
        (status = 200, description = "成功添加收藏", body = favorite_directory::Model),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn favorite_add(
    State(state): State<Arc<AppBaseState>>,
    ValidJson(payload): ValidJson<FavoriteAddPayload>,
) -> Result<Json<favorite_directory::Model>, ApiErr> {
    Ok(Json(service::add(&state.db, payload).await?))
}

#[utoipa::path(
    post,
    path = "/api/favorite/remove",
    tag = "favorite",
    summary = "取消收藏",
    operation_id = "favorite_remove",
    request_body = FavoriteRemovePayload,
    responses(
        (status = 200, description = "成功取消收藏"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn favorite_remove(
    State(state): State<Arc<AppBaseState>>,
    ValidJson(payload): ValidJson<FavoriteRemovePayload>,
) -> Result<(), ApiErr> {
    service::remove(&state.db, payload.target_id, &payload.path).await
}
