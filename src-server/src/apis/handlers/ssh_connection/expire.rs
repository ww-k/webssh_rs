use std::sync::Arc;

use axum::extract::{Query, State};
use serde::Deserialize;
use tracing::{debug, info};

use crate::{apis::ApiErr, ssh_session_pool::SshSessionPool};

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct SshSessionExpirePayload {
    /// SSH 目标 ID
    pub target_id: i32,
    /// 要过期的连接 ID
    pub connection_id: String,
}

#[utoipa::path(
    post,
    path = "/api/ssh_connection/expire",
    tag = "ssh_connection",
    summary = "使 SSH 连接过期",
    description = "强制断开指定的 SSH 连接，使其过期并清理相关资源",
    operation_id = "ssh_connection_expire",
    params(
        SshSessionExpirePayload
    ),
    responses(
        (status = 200, description = "成功使连接过期"),
        (status = 500, description = "服务器内部错误", body = ApiErr)
    )
)]
pub async fn handler(
    State(session_pool): State<Arc<SshSessionPool>>,
    Query(payload): Query<SshSessionExpirePayload>,
) -> Result<(), ApiErr> {
    info!("@ssh_connection {:?}", payload);

    session_pool
        .expire_connection(payload.target_id, payload.connection_id.as_str())
        .await;

    debug!("@ssh_connection done {:?}", payload);
    Ok(())
}
