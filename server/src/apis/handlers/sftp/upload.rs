use std::{io::SeekFrom, pin::pin, sync::Arc};

use axum::{
    Json,
    body::Body,
    extract::{Query, State},
    http::{
        HeaderMap,
        header::{self},
    },
};
use futures_util::TryStreamExt;
use russh_sftp::protocol::{FileAttributes, OpenFlags};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio_util::io::StreamReader;
use tracing::info;

use crate::{AppState, apis::ApiErr, consts::services_err_code::*, map_ssh_err};

use super::{ContentRange, SftpFileUriPayload, get_sftp_session, parse_file_uri};

const CHUNK_SIZE: usize = 8192;

macro_rules! default_up_inv_req_err_op {
    () => {
        |err| ApiErr {
            code: ERR_CODE_SFTP_UPLOAD_INVALID_REQUEST,
            message: err.to_string(),
        }
    };
}

#[derive(Serialize)]
pub struct SftpUploadResponse {
    hash: String,
}

pub async fn handler(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpFileUriPayload>,
    headers: HeaderMap,
    body: Body,
) -> Result<Json<SftpUploadResponse>, ApiErr> {
    info!("@sftp_upload {:?}", payload);

    let h_range = headers.get(header::CONTENT_RANGE);
    let range = ContentRange::from_header_value(h_range);
    let content_len = headers
        .get(header::CONTENT_LENGTH)
        .ok_or(ApiErr {
            code: ERR_CODE_SFTP_UPLOAD_INVALID_REQUEST,
            message: "content-length not found".to_string(),
        })?
        .to_str()
        .map_err(default_up_inv_req_err_op!())?
        .parse::<usize>()
        .map_err(default_up_inv_req_err_op!())?;

    let mut file_size = content_len;
    let mut start: usize = 0;
    let mut range_len = content_len;
    if range.is_some() {
        let range = range.unwrap();
        file_size = range.total;
        start = range.start;
        range_len = range.end - start + 1;
    }

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = get_sftp_session(state, uri.target_id).await?;

    let mut file = map_ssh_err!(
        sftp.open_with_flags(
            uri.path,
            OpenFlags::WRITE | OpenFlags::READ | OpenFlags::CREATE
        )
        .await
    )?;

    map_ssh_err!(
        file.set_metadata(FileAttributes {
            size: Some(file_size as u64),
            ..FileAttributes::empty()
        })
        .await
    )?;

    if start > 0 {
        map_ssh_err!(file.seek(SeekFrom::Start(start as u64)).await)?;
    }

    let mut hasher = Sha256::new();
    let mut total_written = 0usize;

    let body_stream = body
        .into_data_stream()
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err));
    let mut body_reader = pin!(StreamReader::new(body_stream));

    let mut buffer = vec![0; CHUNK_SIZE];
    loop {
        let bytes_read = map_ssh_err!(AsyncReadExt::read(&mut body_reader, &mut buffer).await)?;

        if bytes_read == 0 {
            break;
        }

        if total_written + bytes_read > range_len {
            return Err(ApiErr {
                code: ERR_CODE_SFTP_UPLOAD_INVALID_REQUEST,
                message: "body length exceeds expected range length".to_string(),
            });
        }

        let chunk = &buffer[0..bytes_read];
        map_ssh_err!(file.write_all(chunk).await)?;
        hasher.update(chunk);
        total_written += bytes_read;
    }

    if total_written != range_len {
        return Err(ApiErr {
            code: ERR_CODE_SFTP_UPLOAD_INVALID_REQUEST,
            message: format!(
                "body length mismatch: expected {}, got {}",
                range_len, total_written
            ),
        });
    }

    map_ssh_err!(file.flush().await)?;

    let hash = hasher.finalize();
    let hex_hash = hex::encode(hash);

    info!("@sftp_upload done {:?}", payload);

    Ok(Json(SftpUploadResponse { hash: hex_hash }))
}
