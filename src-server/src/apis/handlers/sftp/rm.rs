use std::sync::Arc;

use axum::extract::{Query, State};
use tracing::{debug, info};

use crate::{
    AppState,
    apis::{ApiErr, InternalErrorResponse},
    consts::services_err_code::*,
    map_ssh_err,
};

use super::{SftpFileUriPayload, parse_file_uri};

#[utoipa::path(
    post,
    path = "/api/sftp/rm",
    tag = "sftp",
    summary = "删除文件",
    description = "删除指定的文件",
    operation_id = "sftp_rm",
    params(
        SftpFileUriPayload
    ),
    responses(
        (status = 200, description = "成功删除文件"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn handler(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<(), ApiErr> {
    info!("@sftp_rm {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = map_ssh_err!(state.session_pool.get_sftp_session(uri.target_id).await)?;
    let _ = map_ssh_err!(sftp.remove_file(uri.path).await)?;

    debug!("@sftp_rm sftp.remove_file done {:?}", payload);

    Ok(())
}
