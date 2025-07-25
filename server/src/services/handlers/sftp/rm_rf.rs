use std::sync::Arc;

use axum::extract::{Query, State};
use tracing::{debug, info};

use crate::{
    consts::services_err_code::*,
    map_db_err, map_ssh_err,
    services::{ApiErr, handlers::ssh_exec, target::get_target_by_id},
};

use super::{AppStateWrapper, SftpFileUriPayload, parse_file_uri};

const WINDOWS: &str = "windows";

pub async fn handler(
    State(state): State<Arc<AppStateWrapper>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<(), ApiErr> {
    info!("@sftp_rm_rf {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let target = map_db_err!(get_target_by_id(&state.app_state.db, uri.target_id).await)?;
    let channel = map_ssh_err!(state.session_pool.get(uri.target_id).await)?;

    if target.system.as_deref() == Some(WINDOWS) {
        let file_path = uri.path[1..].replace("/", "\\");
        ssh_exec::exec(channel, format!(r#"rd /s /q "{}""#, file_path).as_str()).await?;
    } else {
        ssh_exec::exec(channel, format!(r#"rm -rf "{}""#, uri.path).as_str()).await?;
    }

    debug!("@sftp_rm_rf done {:?}", payload);

    Ok(())
}
