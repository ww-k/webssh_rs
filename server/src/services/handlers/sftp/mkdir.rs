use std::sync::Arc;

use axum::extract::{Query, State};
use tracing::{debug, info};

use crate::{map_ssh_err, services::ApiErr};

use super::{AppStateWrapper, SftpFileUriPayload, get_sftp_session, parse_file_uri};
use crate::services::ERR_CODE_SSH_ERR;

pub async fn handler(
    State(state): State<Arc<AppStateWrapper>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<(), ApiErr> {
    info!("@sftp_mkdir {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = get_sftp_session(state, uri.target_id).await?;
    let _ = map_ssh_err!(sftp.create_dir(uri.path).await)?;

    debug!("@sftp_mkdir sftp.create_dir done {:?}", payload);

    Ok(())
}
