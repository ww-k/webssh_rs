use std::sync::Arc;

use axum::{
    Json,
    extract::{Query, State},
};
use tracing::info;

use crate::{AppState, apis::ApiErr, consts::services_err_code::*, map_ssh_err};

use super::{SftpFile, SftpFileUriPayload, get_file_name, parse_file_uri};

#[utoipa::path(
    get,
    path = "/api/sftp/stat",
    tag = "sftp",
    summary = "获取文件信息",
    description = "获取指定文件的详细元数据信息，包括大小、权限、修改时间等",
    operation_id = "sftp_stat",
    params(
        SftpFileUriPayload
    ),
    responses(
        (status = 200, description = "成功获取文件信息", body = SftpFile),
        (status = 500, description = "服务器内部错误")
    )
)]
pub async fn handler(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<Json<SftpFile>, ApiErr> {
    info!("@sftp_stat {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = map_ssh_err!(state.session_pool.get_sftp_session(uri.target_id).await)?;
    let attr = map_ssh_err!(sftp.metadata(uri.path).await)?;
    let file = SftpFile::from_name_attrs(get_file_name(uri.path), attr);
    Ok(Json(file))
}
