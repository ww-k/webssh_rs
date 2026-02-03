use std::sync::Arc;

use axum::{
    Json,
    extract::{Query, State},
};
use serde::Deserialize;
use tracing::{debug, info};

use crate::{
    AppState,
    apis::{ApiErr, InternalErrorResponse},
    consts::services_err_code::*,
    map_ssh_err,
};

use super::{SftpFile, parse_file_uri};

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct SftpLsPayload {
    /// SFTP 文件 URI，格式：sftp://target_id/path
    pub uri: String,
    /// 是否显示所有文件（包括隐藏文件）
    pub all: Option<bool>,
}

#[utoipa::path(
    get,
    path = "/api/sftp/ls",
    tag = "sftp",
    summary = "列出目录文件",
    description = "获取指定目录下的文件和文件夹列表，可选择是否显示隐藏文件",
    operation_id = "sftp_ls",
    params(
        SftpLsPayload
    ),
    responses(
        (status = 200, description = "成功获取目录文件列表", body = [SftpFile]),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn handler(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpLsPayload>,
) -> Result<Json<Vec<SftpFile>>, ApiErr> {
    info!("@sftp_ls {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = map_ssh_err!(state.session_pool.get_sftp_session(uri.target_id).await)?;
    let read_dir = map_ssh_err!(sftp.read_dir(uri.path).await)?;

    debug!("@sftp_ls sftp.read_dir {:?}", payload);

    let files = match payload.all {
        Some(true) => {
            let files = read_dir.map(|dir_entry| SftpFile::from_dir_entry(dir_entry));
            Vec::from_iter(files)
        }
        _ => {
            let files = read_dir
                .filter(|dir_entry| !dir_entry.file_name().starts_with("."))
                .map(|dir_entry| SftpFile::from_dir_entry(dir_entry));
            Vec::from_iter(files)
        }
    };

    Ok(Json(files))
}
