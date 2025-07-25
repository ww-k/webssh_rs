use std::sync::Arc;

use axum::{
    Json,
    extract::{Query, State},
};
use tracing::info;

use crate::{apis::ApiErr, consts::services_err_code::*, map_ssh_err};

use super::{
    AppStateWrapper, SftpFile, SftpFileUriPayload, get_file_name, get_sftp_session, parse_file_uri,
};

pub async fn handler(
    State(state): State<Arc<AppStateWrapper>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<Json<SftpFile>, ApiErr> {
    info!("@sftp_stat {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = get_sftp_session(state, uri.target_id).await?;
    let attr = map_ssh_err!(sftp.metadata(uri.path).await)?;
    let file = SftpFile::from_name_attrs(get_file_name(uri.path), attr);
    Ok(Json(file))
}
