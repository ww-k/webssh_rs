use std::sync::Arc;

use axum::extract::{Query, State};
use tracing::{debug, info};

use crate::{
    AppState,
    apis::{ApiErr, InternalErrorResponse, handlers::ssh::exec::exec, target::get_target_by_id},
    consts::services_err_code::*,
    map_db_err, map_ssh_err,
};

use super::{SftpFileUriPayload, parse_file_uri};

const WINDOWS: &str = "windows";

/// TODO: 优化, 接收多个文件路径，一次删除
#[utoipa::path(
    post,
    path = "/api/sftp/rm_rf",
    tag = "sftp",
    summary = "递归删除文件或目录",
    description = "递归删除指定的文件或目录及其所有子内容",
    operation_id = "sftp_rm_rf",
    params(
        SftpFileUriPayload
    ),
    responses(
        (status = 200, description = "成功递归删除文件或目录"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn handler(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<(), ApiErr> {
    info!("@sftp_rm_rf {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let target = map_db_err!(get_target_by_id(&state.base_state.db, uri.target_id).await)?;
    let channel = map_ssh_err!(state.session_pool.get_channel(uri.target_id).await)?;

    if target.system.as_deref() == Some(WINDOWS) {
        let file_path = uri.path[1..].replace("/", "\\");
        exec(channel, format!(r#"rd /s /q "{}""#, file_path).as_str()).await?;
    } else {
        exec(channel, format!(r#"rm -rf "{}""#, uri.path).as_str()).await?;
    }

    debug!("@sftp_rm_rf done {:?}", payload);

    Ok(())
}
