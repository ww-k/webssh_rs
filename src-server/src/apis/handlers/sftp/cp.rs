use std::sync::Arc;

use axum::extract::{Query, State};
use tracing::{debug, info};

use crate::{
    AppState,
    apis::{ApiErr, handlers::ssh::exec::exec, target::get_target_by_id},
    consts::services_err_code::*,
    map_db_err, map_ssh_err,
};

use super::{SftpRenamePayload, parse_file_uri};

const WINDOWS: &str = "windows";

#[utoipa::path(
    post,
    path = "/api/sftp/cp",
    tag = "sftp",
    summary = "复制文件",
    description = "复制文件或目录到指定位置，支持递归复制",
    operation_id = "sftp_cp",
    params(
        SftpRenamePayload
    ),
    responses(
        (status = 200, description = "成功复制文件"),
        (status = 500, description = "服务器内部错误", body = ApiErr)
    )
)]
pub async fn handler(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpRenamePayload>,
) -> Result<(), ApiErr> {
    info!("@sftp_cp {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let target = map_db_err!(get_target_by_id(&state.base_state.db, uri.target_id).await)?;
    let channel = map_ssh_err!(state.session_pool.get_channel(uri.target_id).await)?;

    if target.system.as_deref() == Some(WINDOWS) {
        todo!();
    } else {
        exec(
            channel,
            format!(r#"cp -r "{}" "{}""#, uri.path, payload.target_path).as_str(),
        )
        .await?;
    }

    debug!("@sftp_cp done {:?}", payload);

    Ok(())
}
