use std::sync::Arc;

use axum::extract::{Query, State};
use tracing::{debug, info};

use crate::{
    AppState,
    apis::{ApiErr, handlers::ssh::exec::exec, target::get_target_by_id},
    consts::services_err_code::*,
    map_db_err, map_ssh_err,
};

use super::{SftpFileUriPayload, parse_file_uri};

const WINDOWS: &str = "windows";

pub async fn handler(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<(), ApiErr> {
    info!("@sftp_rm_rf {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let target = map_db_err!(get_target_by_id(&state.base_state.db, uri.target_id).await)?;
    let channel = map_ssh_err!(state.session_pool.borrow_channel(uri.target_id).await)?;

    if target.system.as_deref() == Some(WINDOWS) {
        let file_path = uri.path[1..].replace("/", "\\");
        exec(channel, format!(r#"rd /s /q "{}""#, file_path).as_str()).await?;
    } else {
        exec(channel, format!(r#"rm -rf "{}""#, uri.path).as_str()).await?;
    }

    debug!("@sftp_rm_rf done {:?}", payload);

    Ok(())
}
