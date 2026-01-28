use std::{collections::HashMap, sync::Arc};

use axum::{
    Json,
    extract::{Query, State},
};
use tracing::{debug, info};

use crate::{apis::ApiErr, ssh_session_pool::SshSessionPool};

#[utoipa::path(
    get,
    path = "/api/ssh_connection/list",
    tag = "ssh_connection",
    summary = "获取 SSH 连接列表",
    description = "获取当前所有活跃的 SSH 连接列表，可按目标 ID 过滤",
    operation_id = "ssh_connection_list",
    params(
        ("target_id" = Option<i32>, description = "过滤指定目标的连接", example = "1")
    ),
    responses(
        (status = 200, description = "成功获取连接列表", body = [crate::ssh_session_pool::ConnectionInfo]),
        (status = 500, description = "服务器内部错误", body = ApiErr)
    )
)]
pub async fn handler(
    State(session_pool): State<Arc<SshSessionPool>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<crate::ssh_session_pool::ConnectionInfo>>, ApiErr> {
    info!("@ssh_connection {:?}", params);
    let target_filter = params.get("target_id").and_then(|s| s.parse::<i32>().ok());

    let list = session_pool.list_all_connections(target_filter).await;

    debug!("@ssh_connection done {:?}", params);
    Ok(Json(list))
}
