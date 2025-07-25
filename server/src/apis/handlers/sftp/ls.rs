use std::sync::Arc;

use axum::{
    Json,
    extract::{Query, State},
};
use serde::Deserialize;
use tracing::{debug, info};

use crate::{AppState, apis::ApiErr, consts::services_err_code::*, map_ssh_err};

use super::{SftpFile, get_sftp_session, parse_file_uri};

#[derive(Debug, Deserialize)]
pub struct SftpLsPayload {
    uri: String,
    all: Option<bool>,
}

pub async fn handler(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpLsPayload>,
) -> Result<Json<Vec<SftpFile>>, ApiErr> {
    info!("@sftp_ls {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = get_sftp_session(state, uri.target_id).await?;
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
