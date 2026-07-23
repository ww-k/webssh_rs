use std::{io::SeekFrom, pin::pin, sync::Arc};

use axum::{
    Json,
    body::{Body, Bytes},
    extract::{Query, State},
    http::{
        HeaderMap, StatusCode,
        header::{self, HeaderValue},
    },
    response::IntoResponse,
};
use futures_util::TryStreamExt;
use sha2::{Digest, Sha256};
use tokio::io::AsyncReadExt;
use tokio_util::io::StreamReader;
use tracing::{debug, info};

use crate::{
    AppState,
    apis::{
        ApiErr, InternalErrorResponse,
        sftp::dto::{
            ContentRange, QueryTargetId, Range, SftpFile, SftpFileUriPayload, SftpLsPayload,
            SftpRenamePayload, SftpUploadResponse,
        },
    },
    consts::services_err_code::*,
    map_db_err, map_ssh_err,
    sftp_client::{SftpAttrs, SftpFileType, SftpOpenOptions},
    ssh_connection_pool::ChannelMode,
};

use super::service::{get_file_name, parse_file_uri};

const WINDOWS: &str = "windows";
const CHUNK_SIZE: usize = 8192;

#[utoipa::path(
    get,
    path = "/api/sftp/ls",
    tag = "sftp",
    summary = "列出目录文件",
    description = "获取指定目录下的文件和文件夹列表，可选择是否显示隐藏文件",
    operation_id = "sftp_ls",
    params(
        SftpLsPayload
    ),
    responses(
        (status = 200, description = "成功获取目录文件列表", body = [SftpFile]),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn ls(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpLsPayload>,
) -> Result<Json<Vec<SftpFile>>, ApiErr> {
    info!("@sftp_ls {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = map_ssh_err!(
        state
            .ssh_service
            .sftp(uri.target_id, ChannelMode::Shared)
            .await
    )?;
    let read_dir = map_ssh_err!(sftp.read_dir(uri.path).await)?;

    debug!("@sftp_ls sftp.read_dir {:?}", payload);

    let files = match payload.all {
        Some(true) => {
            let files = read_dir.into_iter().map(SftpFile::from_dir_entry);
            Vec::from_iter(files)
        }
        _ => {
            let files = read_dir
                .into_iter()
                .filter(|dir_entry| !dir_entry.file_name().starts_with("."))
                .map(SftpFile::from_dir_entry);
            Vec::from_iter(files)
        }
    };

    Ok(Json(files))
}

#[utoipa::path(
    post,
    path = "/api/sftp/mkdir",
    tag = "sftp",
    summary = "创建目录",
    description = "在指定路径创建新目录",
    operation_id = "sftp_mkdir",
    params(
        SftpFileUriPayload
    ),
    responses(
        (status = 200, description = "成功创建目录"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn mkdir(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<(), ApiErr> {
    info!("@sftp_mkdir {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = map_ssh_err!(
        state
            .ssh_service
            .sftp(uri.target_id, ChannelMode::Shared)
            .await
    )?;
    let _ = map_ssh_err!(sftp.create_dir(uri.path).await)?;

    debug!("@sftp_mkdir sftp.create_dir done {:?}", payload);

    Ok(())
}

#[utoipa::path(
    get,
    path = "/api/sftp/stat",
    tag = "sftp",
    summary = "获取文件信息",
    description = "获取指定文件的详细元数据信息，包括大小、权限、修改时间等",
    operation_id = "sftp_stat",
    params(
        SftpFileUriPayload
    ),
    responses(
        (status = 200, description = "成功获取文件信息", body = SftpFile),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn stat(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<Json<SftpFile>, ApiErr> {
    info!("@sftp_stat {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = map_ssh_err!(
        state
            .ssh_service
            .sftp(uri.target_id, ChannelMode::Shared)
            .await
    )?;
    let attr = map_ssh_err!(sftp.metadata(uri.path).await)?;
    let file = SftpFile::from_name_attrs(get_file_name(uri.path), attr);
    Ok(Json(file))
}

#[utoipa::path(
    get,
    path = "/api/sftp/home",
    tag = "sftp",
    summary = "获取主目录路径",
    description = "获取指定 SSH 目标的主目录路径",
    operation_id = "sftp_home",
    params(
        QueryTargetId
    ),
    responses(
        (status = 200, description = "成功获取主目录路径", body = String),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn home(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<QueryTargetId>,
) -> Result<String, ApiErr> {
    info!("@sftp_home {:?}", payload);

    let context = map_db_err!(state.ssh_service.context(payload.target_id).await)?;
    if context.target().system.as_deref() == Some(WINDOWS) {
        return Ok("/C:".to_string());
    }
    let channel = map_ssh_err!(context.channel(ChannelMode::Shared).await)?;

    let home_path = crate::apis::ssh::exec(channel, "pwd").await?;
    let home_path = home_path.trim().to_string();

    debug!("@sftp_home home_path: {}", home_path);

    Ok(home_path)
}

#[utoipa::path(
    post,
    path = "/api/sftp/cp",
    tag = "sftp",
    summary = "复制文件",
    description = "复制文件或目录到指定位置，支持递归复制",
    operation_id = "sftp_cp",
    params(
        SftpRenamePayload
    ),
    responses(
        (status = 200, description = "成功复制文件"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn cp(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpRenamePayload>,
) -> Result<(), ApiErr> {
    info!("@sftp_cp {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let context = map_db_err!(state.ssh_service.context(uri.target_id).await)?;
    let is_windows = context.target().system.as_deref() == Some(WINDOWS);
    let channel = map_ssh_err!(context.channel(ChannelMode::Shared).await)?;

    if is_windows {
        todo!();
    } else {
        crate::apis::ssh::exec(
            channel,
            format!(r#"cp -r "{}" "{}""#, uri.path, payload.target_path).as_str(),
        )
        .await?;
    }

    debug!("@sftp_cp done {:?}", payload);

    Ok(())
}

#[utoipa::path(
    post,
    path = "/api/sftp/rename",
    tag = "sftp",
    summary = "重命名文件",
    description = "重命名文件或将文件移动到新位置",
    operation_id = "sftp_rename",
    params(
        SftpRenamePayload
    ),
    responses(
        (status = 200, description = "成功重命名文件"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn rename(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpRenamePayload>,
) -> Result<(), ApiErr> {
    info!("@sftp_rename {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = map_ssh_err!(
        state
            .ssh_service
            .sftp(uri.target_id, ChannelMode::Shared)
            .await
    )?;
    let _ = map_ssh_err!(sftp.rename(uri.path, payload.target_path.as_str()).await)?;

    debug!("@sftp_rename sftp.rename done {:?}", payload);

    Ok(())
}

#[utoipa::path(
    post,
    path = "/api/sftp/rm",
    tag = "sftp",
    summary = "删除文件",
    description = "删除指定的文件",
    operation_id = "sftp_rm",
    params(
        SftpFileUriPayload
    ),
    responses(
        (status = 200, description = "成功删除文件"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn rm(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<(), ApiErr> {
    info!("@sftp_rm {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = map_ssh_err!(
        state
            .ssh_service
            .sftp(uri.target_id, ChannelMode::Shared)
            .await
    )?;
    let _ = map_ssh_err!(sftp.remove_file(uri.path).await)?;

    debug!("@sftp_rm sftp.remove_file done {:?}", payload);

    Ok(())
}

/// TODO: 优化, 接收多个文件路径，一次删除
#[utoipa::path(
    post,
    path = "/api/sftp/rm_rf",
    tag = "sftp",
    summary = "递归删除文件或目录",
    description = "递归删除指定的文件或目录及其所有子内容",
    operation_id = "sftp_rm_rf",
    params(
        SftpFileUriPayload
    ),
    responses(
        (status = 200, description = "成功递归删除文件或目录"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn rm_rf(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<(), ApiErr> {
    info!("@sftp_rm_rf {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let context = map_db_err!(state.ssh_service.context(uri.target_id).await)?;
    let is_windows = context.target().system.as_deref() == Some(WINDOWS);
    let channel = map_ssh_err!(context.channel(ChannelMode::Shared).await)?;

    if is_windows {
        let file_path = uri.path[1..].replace("/", "\\");
        crate::apis::ssh::exec(channel, format!(r#"rd /s /q "{}""#, file_path).as_str()).await?;
    } else {
        crate::apis::ssh::exec(channel, format!(r#"rm -rf "{}""#, uri.path).as_str()).await?;
    }

    debug!("@sftp_rm_rf done {:?}", payload);

    Ok(())
}

macro_rules! default_up_inv_req_err_op {
    () => {
        |err| ApiErr {
            code: ERR_CODE_SFTP_UPLOAD_INVALID_REQUEST,
            message: err.to_string(),
        }
    };
}

#[utoipa::path(
    put,
    path = "/api/sftp/upload",
    tag = "sftp",
    summary = "上传文件",
    description = "向远程服务器上传文件，支持分块上传和完整性校验",
    operation_id = "sftp_upload",
    params(
        SftpFileUriPayload
    ),
    request_body(
        content = Vec<u8>,
        description = "文件内容",
        content_type = "application/octet-stream"
    ),
    responses(
        (status = 200, description = "成功上传文件", body = SftpUploadResponse),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn upload(
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
    if let Some(range) = range {
        file_size = range.total;
        start = range.start;
        range_len = range.end - start + 1;
    }

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = map_ssh_err!(
        state
            .ssh_service
            .sftp(uri.target_id, ChannelMode::Shared)
            .await
    )?;

    let mut file = map_ssh_err!(
        sftp.open_with_flags(
            uri.path,
            SftpOpenOptions::WRITE | SftpOpenOptions::READ | SftpOpenOptions::CREATE
        )
        .await
    )?;

    map_ssh_err!(
        file.set_metadata(SftpAttrs::with_size(file_size as u64))
            .await
    )?;

    if start > 0 {
        map_ssh_err!(file.seek(SeekFrom::Start(start as u64)).await)?;
    }

    let mut hasher = Sha256::new();
    let mut total_written = 0usize;

    let body_stream = body.into_data_stream().map_err(std::io::Error::other);
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
pub async fn download(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<SftpFileUriPayload>,
    headers: HeaderMap,
) -> Result<axum::response::Response<Body>, ApiErr> {
    info!("@sftp_download {:?}", payload);

    let h_range = headers.get(header::RANGE);
    debug!("@sftp_download range {:?}", h_range);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = map_ssh_err!(
        state
            .ssh_service
            .sftp(uri.target_id, ChannelMode::Shared)
            .await
    )?;

    let file_name = uri.path.split('/').last().unwrap_or("");
    if file_name == "" {
        return Err(ApiErr {
            code: ERR_CODE_SFTP_DOWNLOAD_INVALID_REQUEST,
            message: "uri path can not end with /".to_string(),
        });
    }

    let attr = map_ssh_err!(sftp.metadata(uri.path).await)?;
    if attr.file_type() == SftpFileType::Dir {
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

    let file_size = attr.size.unwrap_or_default() as usize;
    let empty_body = Body::empty();

    if file_size == 0 {
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from_static("0"));
        return Ok((headers, empty_body).into_response());
    }

    let range = Range::from_header_value(h_range);
    let start: usize;
    let range_len;
    let is_partial_content: bool;

    if let Some(range) = range {
        start = range.start;
        range_len = range.end - start + 1;
        is_partial_content = true;

        if file_size <= range.end {
            return Err(ApiErr {
                code: ERR_CODE_SFTP_DOWNLOAD_INVALID_REQUEST,
                message: "range end exceed file size".to_string(),
            });
        }

        headers.insert(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{}", start, range.end, file_size)
                .parse()
                .unwrap(),
        );
    } else {
        start = 0;
        range_len = file_size;
        is_partial_content = false;
    }

    let mut file = map_ssh_err!(sftp.open(uri.path).await)?;

    if start > 0 {
        map_ssh_err!(file.seek(SeekFrom::Start(start as u64)).await)?;
        debug!("@sftp_download file seek {}", start);
    }

    let stream = async_stream::stream! {
        // Keep the SFTP session alive until the response body is consumed or dropped.
        let sftp_guard = sftp;
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
        drop(file);
        sftp_guard.shutdown().await;
    };

    headers.insert(
        header::CONTENT_LENGTH,
        range_len.to_string().parse().unwrap(),
    );
    let body = Body::from_stream(stream);

    debug!("@sftp_download done");

    let response = if is_partial_content {
        (StatusCode::PARTIAL_CONTENT, headers, body).into_response()
    } else {
        (headers, body).into_response()
    };

    Ok(response)
}
