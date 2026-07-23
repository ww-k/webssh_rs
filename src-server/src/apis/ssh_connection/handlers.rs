use std::{collections::HashMap, sync::Arc};

use axum::{
    Json,
    extract::{Query, State},
};
use tracing::{debug, info};

use crate::{
    apis::{
        ApiErr, InternalErrorResponse,
        ssh_connection::{
            dto::{ConnectionInfo, SshConnectionExpirePayload},
            service,
        },
    },
    ssh_connection_pool::SshConnectionPool,
};

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
        (status = 200, description = "成功获取连接列表", body = [ConnectionInfo]),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub(crate) async fn list(
    State(connection_pool): State<Arc<SshConnectionPool>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<ConnectionInfo>>, ApiErr> {
    info!("@ssh_connection {:?}", params);
    let target_filter = params.get("target_id").and_then(|s| s.parse::<i32>().ok());

    let list = service::list(&connection_pool, target_filter).await;

    debug!("@ssh_connection done {:?}", params);
    Ok(Json(list))
}

#[utoipa::path(
    post,
    path = "/api/ssh_connection/expire",
    tag = "ssh_connection",
    summary = "使 SSH 连接过期",
    description = "强制断开指定的 SSH 连接，使其过期并清理相关资源",
    operation_id = "ssh_connection_expire",
    params(
        SshConnectionExpirePayload
    ),
    responses(
        (status = 200, description = "成功使连接过期"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub(crate) async fn expire(
    State(connection_pool): State<Arc<SshConnectionPool>>,
    Query(payload): Query<SshConnectionExpirePayload>,
) -> Result<(), ApiErr> {
    info!("@ssh_connection {:?}", payload);

    service::expire(
        &connection_pool,
        payload.target_id,
        payload.connection_id.as_str(),
    )
    .await;

    debug!("@ssh_connection done {:?}", payload);
    Ok(())
}
