use std::sync::Arc;

use axum::extract::{Query, State};
use tracing::{debug, info};

use crate::{AppState, apis::ApiErr, consts::services_err_code::*, map_ssh_err};

use super::{SftpFileUriPayload, parse_file_uri};

pub async fn handler(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<(), ApiErr> {
    info!("@sftp_mkdir {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = map_ssh_err!(state.session_pool.get_sftp_session(uri.target_id).await)?;
    let _ = map_ssh_err!(sftp.create_dir(uri.path).await)?;

    debug!("@sftp_mkdir sftp.create_dir done {:?}", payload);

    Ok(())
}
