use std::sync::Arc;

use axum::extract::{Query, State};
use tracing::{debug, info};

use crate::{apis::ApiErr, consts::services_err_code::*, map_ssh_err};

use super::{AppStateWrapper, SftpRenamePayload, get_sftp_session, parse_file_uri};

pub async fn handler(
    State(state): State<Arc<AppStateWrapper>>,
    Query(payload): Query<SftpRenamePayload>,
) -> Result<(), ApiErr> {
    info!("@sftp_rename {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = get_sftp_session(state, uri.target_id).await?;
    let _ = map_ssh_err!(sftp.rename(uri.path, payload.target_path.as_str()).await)?;

    debug!("@sftp_rename sftp.rename done {:?}", payload);

    Ok(())
}
