use std::{io::SeekFrom, sync::Arc};

use axum::{
    body::{Body, Bytes},
    extract::{Query, State},
    http::{
        HeaderMap, StatusCode,
        header::{self, HeaderValue},
    },
    response::IntoResponse,
};
use russh_sftp::protocol::FileType;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tracing::{debug, info};

use crate::{
    AppState,
    apis::{ApiErr, InternalErrorResponse},
    consts::services_err_code::*,
    map_ssh_err,
};

use super::{Range, SftpFileUriPayload, parse_file_uri};

const CHUNK_SIZE: usize = 8192;

#[utoipa::path(
    get,
    path = "/api/sftp/download",
    tag = "sftp",
    summary = "下载文件",
    description = "从远程服务器下载文件，支持断点续传和范围下载",
    operation_id = "sftp_download",
    params(
        SftpFileUriPayload
    ),
    responses(
        (status = 200, description = "成功下载完整文件", body = Vec<u8>),
        (status = 206, description = "成功下载部分文件", body = Vec<u8>),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn handler(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpFileUriPayload>,
    headers: HeaderMap,
) -> Result<axum::response::Response<Body>, ApiErr> {
    info!("@sftp_download {:?}", payload);

    let h_range = headers.get(header::RANGE);
    debug!("@sftp_download range {:?}", h_range);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = map_ssh_err!(state.session_pool.get_sftp_session(uri.target_id).await)?;

    let file_name = uri.path.split('/').last().unwrap_or("");
    if file_name == "" {
        return Err(ApiErr {
            code: ERR_CODE_SFTP_DOWNLOAD_INVALID_REQUEST,
            message: "uri path can not end with /".to_string(),
        });
    }

    let attr = map_ssh_err!(sftp.metadata(uri.path).await)?;
    if attr.file_type() == FileType::Dir {
        return Err(ApiErr {
            code: ERR_CODE_SFTP_DOWNLOAD_INVALID_REQUEST,
            message: "file is a directory".to_string(),
        });
    }

    let mut headers = HeaderMap::new();
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}\"", file_name)
            .parse()
            .unwrap(),
    );

    let file_size: usize;
    let empty_body = Body::empty();
    if attr.size.is_none() {
        file_size = 0;
    } else {
        file_size = attr.size.unwrap() as usize;
    }

    if file_size == 0 {
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from_static("0"));
        return Ok((headers, empty_body).into_response());
    }

    let range = Range::from_header_value(h_range);
    let start: usize;
    let range_len;
    let is_partial_content: bool;

    if range.is_some() {
        let range = range.unwrap();
        start = range.start;
        range_len = range.end - start + 1;
        is_partial_content = true;

        if file_size <= range.end {
            return Err(ApiErr {
                code: ERR_CODE_SFTP_DOWNLOAD_INVALID_REQUEST,
                message: "range end exceed file size".to_string(),
            });
        }

        // 设置部分内容的相关头部
        headers.insert(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{}", start, range.end, file_size)
                .parse()
                .unwrap(),
        );
    } else {
        start = 0;
        range_len = attr.size.unwrap() as usize;
        is_partial_content = false;
    }

    let mut file = map_ssh_err!(sftp.open(uri.path).await)?;

    if start > 0 {
        map_ssh_err!(file.seek(SeekFrom::Start(start as u64)).await)?;
        debug!("@sftp_download file seek {}", start);
    }

    let stream = async_stream::stream! {
        let mut remaining = range_len;
        while remaining > 0 {
            let chunk_size = std::cmp::min(CHUNK_SIZE, remaining);
            let mut buffer = vec![0; chunk_size];

            match file.read_exact(&mut buffer).await {
                Ok(_) => {
                    yield Ok(Bytes::from(buffer));
                    remaining -= chunk_size;
                }
                Err(e) => {
                    yield Err(axum::Error::new(e));
                    break;
                }
            }
        }
    };

    headers.insert(
        header::CONTENT_LENGTH,
        range_len.to_string().parse().unwrap(),
    );
    let body = Body::from_stream(stream);

    debug!("@sftp_download done");

    // 根据是否为部分下载返回相应状态码
    let response = if is_partial_content {
        (StatusCode::PARTIAL_CONTENT, headers, body).into_response()
    } else {
        (headers, body).into_response()
    };

    Ok(response)
}
