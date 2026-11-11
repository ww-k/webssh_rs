use std::{
    collections::{BTreeMap, VecDeque},
    pin::pin,
    sync::Arc,
};

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
            SftpRenamePayload, SftpUploadResponse, SftpUserDir,
        },
    },
    consts::services_err_code::*,
    map_db_err, map_ssh_err,
    sftp_client::{
        SftpClientGuard, SftpFileType,
        transfer::{
            DEFAULT_PIPELINE_CHUNK_SIZE, DEFAULT_READ_MAX_IN_FLIGHT,
            DEFAULT_READ_PIPELINE_CHUNK_SIZE, DEFAULT_WRITE_MAX_IN_FLIGHT,
            DEFAULT_WRITE_RESPONSE_TIMEOUT,
        },
    },
    ssh_connection_pool::ChannelMode,
};

use super::service::{discover_user_dirs, get_file_name, parse_file_uri, resolve_user_dir_home};

const WINDOWS: &str = "windows";

struct DownloadHandleGuard {
    client: Option<SftpClientGuard>,
    handle: Arc<[u8]>,
}

impl DownloadHandleGuard {
    fn new(client: SftpClientGuard, handle: Arc<[u8]>) -> Self {
        Self {
            client: Some(client),
            handle,
        }
    }

    fn client(&self) -> &SftpClientGuard {
        self.client
            .as_ref()
            .expect("download handle guard is empty")
    }

    async fn shutdown(mut self) {
        let Some(client) = self.client.take() else {
            return;
        };
        let sftp = std::ops::Deref::deref(&client).clone();
        let _ = sftp.close(self.handle.to_vec()).await;
        client.shutdown().await;
    }
}

impl Drop for DownloadHandleGuard {
    fn drop(&mut self) {
        let Some(client) = self.client.take() else {
            return;
        };
        let sftp = std::ops::Deref::deref(&client).clone();
        let handle = Arc::clone(&self.handle);
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                let _ = sftp.close(handle.to_vec()).await;
                client.shutdown().await;
            });
        }
    }
}

struct UploadHandleGuard {
    client: Option<SftpClientGuard>,
    handle: Arc<[u8]>,
}

impl UploadHandleGuard {
    fn new(client: SftpClientGuard, handle: Vec<u8>) -> Self {
        Self {
            client: Some(client),
            handle: Arc::from(handle),
        }
    }

    fn client(&self) -> &SftpClientGuard {
        self.client.as_ref().expect("upload handle guard is empty")
    }

    async fn close(mut self) -> Result<(), crate::sftp_client::SftpError> {
        let client = self.client.take().expect("upload handle guard is empty");
        client.close(self.handle.to_vec()).await
    }
}

impl Drop for UploadHandleGuard {
    fn drop(&mut self) {
        let Some(client) = self.client.take() else {
            return;
        };
        let sftp = std::ops::Deref::deref(&client).clone();
        let handle = Arc::clone(&self.handle);
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                let _ = sftp.close(handle.to_vec()).await;
                drop(client);
            });
        }
    }
}

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
            .connection_pool
            .sftp(uri.target_id, ChannelMode::Shared)
            .await
    )?;
    let read_dir = map_ssh_err!(sftp.read_dir(uri.path).await)?;

    debug!("@sftp_ls sftp.read_dir {:?}", payload);

    let entries = match payload.all {
        Some(true) => read_dir,
        _ => read_dir
            .into_iter()
            .filter(|dir_entry| !dir_entry.file_name().starts_with("."))
            .collect(),
    };
    let mut files = Vec::with_capacity(entries.len());
    for dir_entry in entries {
        let (name, attrs) = dir_entry.into_parts();
        let is_dir = if attrs.file_type() == SftpFileType::Symlink {
            let path = if uri.path == "/" {
                format!("/{name}")
            } else {
                format!("/{}/{}", uri.path.trim_matches('/'), name)
            };
            map_ssh_err!(sftp.metadata(path).await)
                .ok()
                .is_some_and(|target| target.file_type() == SftpFileType::Dir)
        } else {
            attrs.file_type() == SftpFileType::Dir
        };
        files.push(SftpFile::from_name_attrs_with_dir(name, attrs, is_dir));
    }

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
            .connection_pool
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
            .connection_pool
            .sftp(uri.target_id, ChannelMode::Shared)
            .await
    )?;
    let attr = map_ssh_err!(sftp.metadata(uri.path).await)?;
    let file = SftpFile::from_name_attrs(get_file_name(uri.path), attr);
    Ok(Json(file))
}

#[utoipa::path(
    get,
    path = "/api/sftp/user-dirs/home",
    tag = "sftp",
    summary = "获取主目录路径",
    description = "通过 SFTP REALPATH 获取指定 SSH 目标的主目录路径，不支持时返回根目录",
    operation_id = "sftp_user_dir_home",
    params(
        QueryTargetId
    ),
    responses(
        (status = 200, description = "成功获取主目录路径", body = String),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn user_dir_home(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<QueryTargetId>,
) -> Result<String, ApiErr> {
    info!("@sftp_user_dir_home {:?}", payload);

    let sftp = map_ssh_err!(
        state
            .connection_pool
            .sftp(payload.target_id, ChannelMode::Shared)
            .await
    )?;
    resolve_user_dir_home(&sftp).await
}

#[utoipa::path(
    get,
    path = "/api/sftp/user-dirs",
    tag = "sftp",
    summary = "获取远端用户目录",
    description = "获取指定 SSH 目标的根目录、主目录及主目录下实际存在的桌面、文档和下载目录",
    operation_id = "sftp_user_dirs",
    params(
        QueryTargetId
    ),
    responses(
        (status = 200, description = "成功获取远端用户目录", body = Vec<SftpUserDir>),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn user_dirs(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<QueryTargetId>,
) -> Result<Json<Vec<SftpUserDir>>, ApiErr> {
    info!("@sftp_user_dirs {:?}", payload);

    Ok(Json(
        discover_user_dirs(&state.connection_pool, payload.target_id).await?,
    ))
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
    let context = map_db_err!(state.connection_pool.context(uri.target_id).await)?;
    let is_windows = context.target().system.as_deref() == Some(WINDOWS);
    let channel = map_ssh_err!(context.channel(ChannelMode::Shared).await)?;

    if is_windows {
        let source_path = windows_path(uri.path);
        let target_path = windows_path(&payload.target_path);
        let script = format!(
            "try {{ Copy-Item -LiteralPath '{}' -Destination '{}' -Recurse -Force -ErrorAction Stop; exit 0 }} catch {{ [Console]::Error.WriteLine($_); exit 1 }}",
            powershell_literal(&source_path),
            powershell_literal(&target_path),
        );
        let encoded_script = encode_powershell_command(&script);
        crate::apis::ssh::exec(
            channel,
            format!("powershell.exe -NoProfile -NonInteractive -EncodedCommand {encoded_script}")
                .as_str(),
        )
        .await?;
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

fn windows_path(path: &str) -> String {
    path.strip_prefix('/').unwrap_or(path).replace('/', "\\")
}

fn powershell_literal(value: &str) -> String {
    value.replace('\'', "''")
}

fn encode_powershell_command(command: &str) -> String {
    const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let bytes = command
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect::<Vec<_>>();
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied();
        let third = chunk.get(2).copied();
        encoded.push(BASE64[(first >> 2) as usize] as char);
        encoded.push(
            BASE64[(((first & 0b11) << 4) | (second.unwrap_or_default() >> 4)) as usize] as char,
        );
        encoded.push(match second {
            Some(second) => {
                BASE64[(((second & 0b1111) << 2) | (third.unwrap_or_default() >> 6)) as usize]
                    as char
            }
            None => '=',
        });
        encoded.push(match third {
            Some(third) => BASE64[(third & 0b0011_1111) as usize] as char,
            None => '=',
        });
    }

    encoded
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
            .connection_pool
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
            .connection_pool
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
    let context = map_db_err!(state.connection_pool.context(uri.target_id).await)?;
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
            .connection_pool
            .sftp(uri.target_id, ChannelMode::Shared)
            .await
    )?;

    let handle = map_ssh_err!(sftp.open_upload_range(uri.path).await)?;
    let handle_guard = UploadHandleGuard::new(sftp, handle);
    let sftp = handle_guard.client();
    map_ssh_err!(
        sftp.set_size(handle_guard.handle.as_ref(), file_size as u64)
            .await
    )?;

    let mut hasher = Sha256::new();
    let mut total_written = 0usize;

    let body_stream = body.into_data_stream().map_err(std::io::Error::other);
    let mut body_reader = pin!(StreamReader::new(body_stream));
    let mut buffer = vec![0; DEFAULT_PIPELINE_CHUNK_SIZE];
    let mut pending = VecDeque::with_capacity(DEFAULT_WRITE_MAX_IN_FLIGHT);
    let mut eof = false;
    while total_written < range_len && !eof {
        let chunk_len = std::cmp::min(buffer.len(), range_len - total_written);
        let mut filled = 0;
        while filled < chunk_len {
            let bytes_read = map_ssh_err!(
                AsyncReadExt::read(&mut body_reader, &mut buffer[filled..chunk_len]).await
            )?;
            if bytes_read == 0 {
                eof = true;
                break;
            }
            filled += bytes_read;
        }

        if filled == 0 {
            break;
        }

        hasher.update(&buffer[..filled]);
        let data: Box<[u8]> = buffer[..filled].into();
        let write = map_ssh_err!(
            sftp.begin_write(
                Arc::clone(&handle_guard.handle),
                (start + total_written) as u64,
                data
            )
            .await
        )?;
        pending.push_back(write);
        total_written += filled;

        if pending.len() >= DEFAULT_WRITE_MAX_IN_FLIGHT {
            let write = pending.pop_front().expect("pending write queue is full");
            let result = tokio::time::timeout(DEFAULT_WRITE_RESPONSE_TIMEOUT, write.wait())
                .await
                .map_err(|err| ApiErr {
                    code: ERR_CODE_SSH_ERR,
                    message: err.to_string(),
                })?;
            map_ssh_err!(result)?;
        }
    }

    if total_written == range_len {
        let mut extra_byte = [0; 1];
        if map_ssh_err!(AsyncReadExt::read(&mut body_reader, &mut extra_byte).await)? > 0 {
            return Err(ApiErr {
                code: ERR_CODE_SFTP_UPLOAD_INVALID_REQUEST,
                message: "body length exceeds expected range length".to_string(),
            });
        }
    }

    while let Some(write) = pending.pop_front() {
        let result = tokio::time::timeout(DEFAULT_WRITE_RESPONSE_TIMEOUT, write.wait())
            .await
            .map_err(|err| ApiErr {
                code: ERR_CODE_SSH_ERR,
                message: err.to_string(),
            })?;
        map_ssh_err!(result)?;
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

    map_ssh_err!(handle_guard.close().await)?;

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
            .connection_pool
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

    let handle = map_ssh_err!(sftp.open_read_handle(uri.path).await)?;
    let handle: Arc<[u8]> = Arc::from(handle);
    let range_end = (start + range_len - 1) as u64;

    let stream = async_stream::stream! {
        // Keep the SFTP handle alive until the response body is consumed or dropped.
        let handle_guard = DownloadHandleGuard::new(sftp, Arc::clone(&handle));
        let sftp = handle_guard.client();
        let mut read_stream = sftp.read_stream();
        let mut pending_responses: BTreeMap<u64, (u64, Vec<u8>)> = BTreeMap::new();
        let mut request_ends = BTreeMap::new();
        let mut retry_requests = VecDeque::new();
        let mut read_requests = Vec::with_capacity(DEFAULT_READ_MAX_IN_FLIGHT);
        let mut next_offset = start as u64;
        let mut contiguous_done = start as u64;
        let mut in_flight = 0usize;

        loop {
            read_requests.clear();
            while in_flight + pending_responses.len() + read_requests.len()
                < DEFAULT_READ_MAX_IN_FLIGHT
            {
                let (offset, chunk_size) = if let Some(request) = retry_requests.pop_front() {
                    request
                } else if next_offset <= range_end {
                    let offset = next_offset;
                    let chunk_size = std::cmp::min(
                        DEFAULT_READ_PIPELINE_CHUNK_SIZE as u64,
                        range_end - next_offset + 1,
                    ) as usize;
                    next_offset += chunk_size as u64;
                    (offset, chunk_size)
                } else {
                    break;
                };
                read_requests.push((offset, chunk_size));
            }

            match read_stream
                .begin_reads(Arc::clone(&handle), &read_requests)
                .await
            {
                Ok(started) => {
                    in_flight += started;
                    for &(offset, len) in read_requests.iter().take(started) {
                        request_ends.insert(offset, offset + len as u64 - 1);
                    }
                }
                Err(err) => {
                    yield Err(axum::Error::new(err));
                    break;
                }
            }

            if let Some((requested_end, data)) = pending_responses.remove(&contiguous_done) {
                if data.is_empty() {
                    yield Err(axum::Error::new(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        format!("sftp download reached eof before offset {}", range_end + 1),
                    )));
                    break;
                }
                let data_end = contiguous_done + data.len() as u64 - 1;
                if data_end > requested_end {
                    yield Err(axum::Error::new(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!(
                            "sftp download read past request end: got {data_end}, expected {requested_end}"
                        ),
                    )));
                    break;
                }
                yield Ok(Bytes::from(data));
                contiguous_done = data_end + 1;
                if data_end < requested_end {
                    retry_requests.push_front((
                        contiguous_done,
                        (requested_end - data_end) as usize,
                    ));
                }
                continue;
            }

            if in_flight == 0 {
                break;
            }

            let (offset, data) = match read_stream.recv_data().await {
                Ok(response) => response,
                Err(err) => {
                    yield Err(axum::Error::new(err));
                    break;
                }
            };
            in_flight -= 1;
            let Some(requested_end) = request_ends.remove(&offset) else {
                yield Err(axum::Error::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("missing sftp download request for response offset {offset}"),
                )));
                break;
            };
            let data = data.into_vec();
            if offset == contiguous_done {
                if data.is_empty() {
                    yield Err(axum::Error::new(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        format!("sftp download reached eof before offset {}", range_end + 1),
                    )));
                    break;
                }
                let data_end = offset + data.len() as u64 - 1;
                if data_end > requested_end {
                    yield Err(axum::Error::new(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!(
                            "sftp download read past request end: got {data_end}, expected {requested_end}"
                        ),
                    )));
                    break;
                }
                yield Ok(Bytes::from(data));
                contiguous_done = data_end + 1;
                if data_end < requested_end {
                    retry_requests.push_front((
                        contiguous_done,
                        (requested_end - data_end) as usize,
                    ));
                }
            } else if pending_responses.insert(offset, (requested_end, data)).is_some() {
                yield Err(axum::Error::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("duplicate sftp download response for offset {offset}"),
                )));
                break;
            }
        }
        handle_guard.shutdown().await;
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
