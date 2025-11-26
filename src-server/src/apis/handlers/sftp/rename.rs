use std::sync::Arc;

use axum::extract::{Query, State};
use tracing::{debug, info};

use crate::{AppState, apis::ApiErr, consts::services_err_code::*, map_ssh_err};

use super::{SftpRenamePayload, parse_file_uri};

#[utoipa::path(
    post,
    path = "/api/sftp/rename",
    tag = "sftp",
    summary = "重命名文件",
    description = "重命名文件或将文件移动到新位置",
    operation_id = "sftp_rename",
    params(
        ("uri" = String, description = "源文件路径，格式: sftp://target_id/path", example = "sftp://1/home/user/oldname.txt"),
        ("target_path" = String, description = "目标路径", example = "/home/user/newname.txt")
    ),
    responses(
        (status = 200, description = "成功重命名文件"),
        (status = 500, description = "服务器内部错误")
    )
)]
pub async fn handler(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpRenamePayload>,
) -> Result<(), ApiErr> {
    info!("@sftp_rename {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = map_ssh_err!(state.session_pool.get_sftp_session(uri.target_id).await)?;
    let _ = map_ssh_err!(sftp.rename(uri.path, payload.target_path.as_str()).await)?;

    debug!("@sftp_rename sftp.rename done {:?}", payload);

    Ok(())
}
