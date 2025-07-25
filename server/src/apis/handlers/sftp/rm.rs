use std::sync::Arc;

use axum::extract::{Query, State};
use tracing::{debug, info};

use crate::{apis::ApiErr, consts::services_err_code::*, map_ssh_err};

use super::{AppStateWrapper, SftpFileUriPayload, get_sftp_session, parse_file_uri};

pub async fn handler(
    State(state): State<Arc<AppStateWrapper>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<(), ApiErr> {
    info!("@sftp_rm {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = get_sftp_session(state, uri.target_id).await?;
    let _ = map_ssh_err!(sftp.remove_file(uri.path).await)?;

    debug!("@sftp_rm sftp.remove_file done {:?}", payload);

    Ok(())
}
