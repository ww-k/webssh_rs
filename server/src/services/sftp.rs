use std::{io::SeekFrom, sync::Arc};

use axum::{
    Json, Router,
    body::Bytes,
    extract::{Query, State},
    http::{
        HeaderMap,
        header::{self, HeaderValue},
    },
    response::IntoResponse,
    routing::{get, post},
};
use russh::ChannelMsg;
use russh_sftp::{
    client::{RawSftpSession, SftpSession, fs::DirEntry},
    protocol::{FileAttributes, FileType, OpenFlags},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tracing::{debug, info};

use crate::{AppState, services::target::get_target_by_id, ssh_session_pool::SshSessionPool};
use crate::{consts::services_err_code::*, ssh_session_pool::SshChannelGuard};

use super::ApiErr;

struct AppStateWrapper {
    #[allow(dead_code)]
    app_state: Arc<AppState>,
    session_pool: Arc<SshSessionPool>,
}

pub(crate) fn svc_sftp_router_builder(
    app_state: Arc<AppState>,
    session_pool: Arc<SshSessionPool>,
) -> Router {
    Router::new()
        .route("/ls", get(sftp_ls))
        .route("/mkdir", post(sftp_mkdir))
        .route("/stat", get(sftp_stat))
        .route("/home", get(sftp_home))
        .route("/cp", post(sftp_cp))
        .route("/rename", post(sftp_rename))
        .route("/rm", post(sftp_rm))
        .route("/rm/rf", post(sftp_rm_rf))
        .route("/upload", post(sftp_upload))
        .route("/download", get(sftp_download))
        .fallback(|| async { "not supported" })
        .with_state(Arc::new(AppStateWrapper {
            app_state,
            session_pool,
        }))
}

const URI_SEP: &str = ":";
const PATH_SEP: &str = "/";
const WINDOWS: &str = "windows";

#[derive(Serialize)]
pub struct SftpFile {
    pub name: String,
    /// 'd' for directory, 'f' for regular file, 'l' for symbolic link, '?' for other
    pub r#type: char,
    pub size: Option<u64>,
    pub atime: Option<u32>,
    pub mtime: Option<u32>,
    pub permissions: String,
}

impl SftpFile {
    fn from_dir_entry(dir_entry: DirEntry) -> Self {
        let attrs = dir_entry.metadata();
        Self::from_name_attrs(dir_entry.file_name(), attrs)
    }

    fn from_name_attrs(name: String, attrs: FileAttributes) -> Self {
        let permissions = attrs.permissions();
        SftpFile {
            name,
            r#type: match attrs.file_type() {
                FileType::File => 'f',
                FileType::Dir => 'd',
                FileType::Symlink => 'l',
                _ => '?',
            },
            size: attrs.size,
            atime: attrs.atime,
            mtime: attrs.mtime,
            permissions: permissions.to_string(),
        }
    }

    fn mode_to_permissions(mode: u32) -> String {
        let mut s = String::with_capacity(9);
        let perms = ['r', 'w', 'x']; // 权限字符

        for i in (0..3).rev() {
            // owner, group, other
            let octet = (mode >> (i * 3)) & 0b111;
            for j in 0..3 {
                s.push(if octet & (0b100 >> j) != 0 {
                    perms[j]
                } else {
                    '-'
                });
            }
        }

        s
    }

    /// 将路径分隔位为(parent_path, file_name)
    fn split_path(path: &str) -> Option<(&str, &str)> {
        if path == PATH_SEP {
            return None;
        }
        if !path.starts_with(PATH_SEP) {
            return None;
        }

        let mut split = path.split(PATH_SEP);
        let file_name = split.last();
        let path_len = path.len();
        match file_name {
            Some(file_name) => {
                if file_name == "" {
                    let path1 = &path[..path_len - 1];
                    split = path1.split(PATH_SEP);
                    let file_name = split.last().unwrap();
                    let parent_path = &path1[..path1.len() - file_name.len()];
                    Some((parent_path, file_name))
                } else {
                    let parent_path = &path[..path_len - file_name.len()];
                    Some((parent_path, file_name))
                }
            }
            None => None,
        }
    }

    /// 解析GNU风格的stat输出（格式：%n,%s,%x,%y,%a,%F）
    // 示例输入:
    // /Users/xxx/Downloads/test,160,1751351720,1749194783,755,directory\n
    // /Users/xxx/Downloads/test/file,160,1751351720,1749194783,755,regular file\n
    // /Users/xxx/Downloads/test/file,160,1751351720,1749194783,755,symbolic link\n
    #[allow(dead_code)]
    fn from_stat_gnu(output: &str) -> Result<Self, ApiErr> {
        let sep = ",";
        let mut parts: Vec<&str> = output.split(sep).collect();

        if parts.len() < 6 {
            return Err(ApiErr {
                code: ERR_CODE_SSH_EXEC,
                message: format!("Invalid stat output format. parts len less than 6."),
            });
        }

        parts.reverse();

        let r#type = match parts[0].trim() {
            "directory" => 'd',
            "regular file" => 'f',
            "symbolic link" => 'l',
            _ => '?',
        };

        let permissions = match u32::from_str_radix(parts[1], 8) {
            Ok(mode) => Self::mode_to_permissions(mode),
            Err(_) => {
                return Err(ApiErr {
                    code: ERR_CODE_SSH_EXEC,
                    message: format!(
                        "Invalid stat output format. Failed to parse file size: {}",
                        parts[1]
                    ),
                });
            }
        };

        let mtime = parts[2].parse::<u32>().ok();

        let atime = parts[3].parse::<u32>().ok();

        let size = Some(parts[4].parse::<u64>().map_err(|_| ApiErr {
            code: ERR_CODE_SSH_EXEC,
            message: format!("Failed to parse file size: {}", parts[1]),
        })?);

        // 处理文件名中有,的情况
        let mut parts5 = parts[5..].to_vec();
        parts5.reverse();
        let path = parts5.join(sep);
        let name = match Self::split_path(path.as_str()) {
            Some((_, name)) => name.to_string(),
            None => path,
        };

        Ok(Self {
            name,
            r#type,
            size,
            atime,
            mtime,
            permissions,
        })
    }

    /// 解析GNU风格的stat输出（格式：%n,%s,%x,%y,%a,%F）
    // 示例输入:
    // /Users/xxx/Downloads/test,160,1720508748,1720508748,drwxr-xr-x,Directory\n
    // /Users/xxx/Downloads/test/file,160,1720508748,1720508748,drwxr-xr-x,Regular File\n
    // /Users/xxx/Downloads/test/file,160,1720508748,1720508748,drwxr-xr-x,Symbolic Link\n
    #[allow(dead_code)]
    fn from_stat_bsd(output: &str) -> Result<Self, ApiErr> {
        let sep = ",";
        let mut parts: Vec<&str> = output.split(sep).collect();

        if parts.len() < 6 {
            return Err(ApiErr {
                code: ERR_CODE_SSH_EXEC,
                message: format!("Invalid stat output format. parts len less than 6."),
            });
        }

        parts.reverse();

        let r#type = match parts[0].trim() {
            "Directory" => 'd',
            "Regular File" => 'f',
            "Symbolic Link" => 'l',
            _ => '?',
        };

        let permissions = parts[1][1..].to_string();

        let mtime = parts[2].parse::<u32>().ok();

        let atime = parts[3].parse::<u32>().ok();

        let size = Some(parts[4].parse::<u64>().map_err(|_| ApiErr {
            code: ERR_CODE_SSH_EXEC,
            message: format!(
                "Invalid stat output format. Failed to parse file size: {}",
                parts[1]
            ),
        })?);

        // 处理文件名中有,的情况
        let mut parts5 = parts[5..].to_vec();
        parts5.reverse();
        let path = parts5.join(sep);
        let name = match Self::split_path(path.as_str()) {
            Some((_, name)) => name.to_string(),
            None => path,
        };

        Ok(Self {
            name,
            r#type,
            size,
            atime,
            mtime,
            permissions,
        })
    }
}

impl Default for SftpFile {
    fn default() -> Self {
        SftpFile {
            name: "".to_string(),
            r#type: '?',
            size: None,
            atime: None,
            mtime: None,
            permissions: "".to_string(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct SftpTargetPayload {
    target_id: i32,
}

#[derive(Debug, Deserialize)]
struct SftpFileUriPayload {
    uri: String,
}

#[derive(Debug, Deserialize)]
struct SftpLsPayload {
    uri: String,
    all: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct SftpRenamePayload {
    uri: String,
    target_path: String,
}

#[derive(Debug)]
struct SftpFileUri<'a> {
    target_id: i32,
    path: &'a str,
}

impl<'a> SftpFileUri<'a> {
    fn from_str(str: &'a str) -> Option<Self> {
        // linux，unix sftp:1/Users/xxx
        // windows sftp:1/C:/Users/xxx
        let mut split = str.split(URI_SEP);
        if Some("sftp") != split.next() {
            return None;
        }

        let target_id_str = split.next();
        let target_id = match target_id_str {
            Some(id) => id.parse::<i32>().ok()?,
            None => return None,
        };
        let offset = 6 + target_id_str.unwrap().len();
        let mut path = &str[offset..];

        if !path.starts_with(PATH_SEP) {
            return None;
        }

        if path.split(PATH_SEP).last() == Some("") {
            path = &path[..path.len() - 1];
        }

        Some(SftpFileUri { target_id, path })
    }
}

struct SftpSvcSession {}

/// 将错误转换为 code 为 ERR_CODE_SSH_ERR 的 ApiErr
macro_rules! map_ssh_err {
    ($expr:expr) => {
        $expr.map_err(|err| ApiErr {
            code: ERR_CODE_SSH_ERR,
            message: err.to_string(),
        })
    };
}

/// 将错误转换为 code 为 ERR_CODE_DB_ERR 的 ApiErr
macro_rules! map_db_err {
    ($expr:expr) => {
        $expr.map_err(|err| ApiErr {
            code: ERR_CODE_DB_ERR,
            message: err.to_string(),
        })
    };
}

macro_rules! default_up_inv_req_err_op {
    () => {
        |err| ApiErr {
            code: ERR_CODE_SFTP_UPLOAD_INVALID_REQUEST,
            message: err.to_string(),
        }
    };
}

fn parse_file_uri(file_uri_str: &str) -> Result<SftpFileUri, ApiErr> {
    let uri = SftpFileUri::from_str(file_uri_str);
    uri.ok_or(ApiErr {
        code: ERR_CODE_SFTP_INVALID_URI,
        message: "invalid uri".to_string(),
    })
}

fn get_file_name(path: &str) -> String {
    let split = path.split(PATH_SEP);
    let Some(name) = split.last() else {
        return "".to_string();
    };
    name.to_string()
}

async fn get_sftp_session(
    state: Arc<AppStateWrapper>,
    target_id: i32,
) -> Result<SftpSession, ApiErr> {
    let mut guard = map_ssh_err!(state.session_pool.get(target_id).await)?;
    let channel = guard.take_channel().ok_or(ApiErr {
        code: ERR_CODE_SSH_ERR,
        message: "take none channel".to_string(),
    })?;
    let _ = map_ssh_err!(channel.request_subsystem(true, "sftp").await)?;
    let sftp = map_ssh_err!(SftpSession::new(channel.into_stream()).await)?;
    // TODO: reuse SftpSession
    Ok(sftp)
}

async fn get_raw_sftp_session(
    state: Arc<AppStateWrapper>,
    target_id: i32,
) -> Result<RawSftpSession, ApiErr> {
    let mut guard = map_ssh_err!(state.session_pool.get(target_id).await)?;
    let channel = guard.take_channel().ok_or(ApiErr {
        code: ERR_CODE_SSH_ERR,
        message: "take none channel".to_string(),
    })?;
    let _ = map_ssh_err!(channel.request_subsystem(true, "sftp").await)?;
    let sftp = RawSftpSession::new(channel.into_stream());
    // TODO: reuse SftpSession
    Ok(sftp)
}

async fn ssh_exec(mut channel: SshChannelGuard, command: &str) -> Result<String, ApiErr> {
    debug!("@ssh_exec start {:?}", command);
    map_ssh_err!(channel.exec(true, command).await)?;

    let mut code = None;
    let mut buf = Vec::<u8>::new();
    let mut buf_e = Vec::<u8>::new();

    loop {
        // There's an event available on the session channel
        let Some(msg) = channel.wait().await else {
            break;
        };
        match msg {
            ChannelMsg::ExtendedData { ref data, ext: _ } => {
                buf_e.extend_from_slice(data);
            }
            // Write data to the terminal
            ChannelMsg::Data { ref data } => {
                buf.extend_from_slice(data);
            }
            // The command has returned an exit code
            ChannelMsg::ExitStatus { exit_status } => {
                code = Some(exit_status);
                // cannot leave the loop immediately, there might still be more data to receive
            }
            _ => {}
        }
    }
    let str = String::from_utf8_lossy(&buf);
    let str_e = String::from_utf8_lossy(&buf_e);
    debug!("@ssh_exec done {:?}", command);
    debug!("exit_status {:?}. result ", code);
    debug!("{:?}", str);
    match code {
        Some(0) => Ok(str.to_string()),
        _ => Err(ApiErr {
            code: ERR_CODE_SSH_EXEC,
            message: format!("exit status {:?}. result\n {}", code, str_e),
        }),
    }
}

async fn sftp_home(
    State(state): State<Arc<AppStateWrapper>>,
    Query(payload): Query<SftpTargetPayload>,
) -> Result<String, ApiErr> {
    info!("@sftp_home {:?}", payload);

    let target = map_db_err!(get_target_by_id(&state.app_state.db, payload.target_id).await)?;
    let channel = map_ssh_err!(state.session_pool.get(payload.target_id).await)?;
    if target.system.as_deref() == Some(WINDOWS) {
        return Ok("/C:".to_string());
    }

    let home_path = ssh_exec(channel, "pwd").await?;
    let home_path = home_path.trim().to_string();
    // TODO: 缓存，存入SftpSvcSession

    debug!("@sftp_home home_path: {}", home_path);

    Ok(home_path)
}

async fn sftp_ls(
    State(state): State<Arc<AppStateWrapper>>,
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

async fn sftp_mkdir(
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

async fn sftp_stat(
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

async fn sftp_cp(
    State(state): State<Arc<AppStateWrapper>>,
    Query(payload): Query<SftpRenamePayload>,
) -> Result<(), ApiErr> {
    info!("@sftp_cp {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let target = map_db_err!(get_target_by_id(&state.app_state.db, uri.target_id).await)?;
    let channel = map_ssh_err!(state.session_pool.get(uri.target_id).await)?;

    if target.system.as_deref() == Some(WINDOWS) {
        // let file_path = uri.path[1..].replace("/", "\\");
        todo!();
    } else {
        ssh_exec(
            channel,
            format!(r#"cp -r "{}" "{}""#, uri.path, payload.target_path).as_str(),
        )
        .await?;
    }

    debug!("@sftp_cp done {:?}", payload);

    Ok(())
}

async fn sftp_rename(
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

async fn sftp_rm(
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

async fn sftp_rm_rf(
    State(state): State<Arc<AppStateWrapper>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<(), ApiErr> {
    info!("@sftp_rm_rf {:?}", payload);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let target = map_db_err!(get_target_by_id(&state.app_state.db, uri.target_id).await)?;
    let channel = map_ssh_err!(state.session_pool.get(uri.target_id).await)?;

    if target.system.as_deref() == Some(WINDOWS) {
        let file_path = uri.path[1..].replace("/", "\\");
        ssh_exec(channel, format!(r#"rd /s /q "{}""#, file_path).as_str()).await?;
    } else {
        ssh_exec(channel, format!(r#"rm -rf "{}""#, uri.path).as_str()).await?;
    }

    debug!("@sftp_rm_rf done {:?}", payload);

    Ok(())
}

#[derive(Debug)]
struct ContentRange {
    start: usize,
    end: usize,
    total: usize,
}

impl ContentRange {
    fn from_str(header: &str) -> Option<Self> {
        // Content-Range: bytes 0-1023/1024
        let header = header.trim();

        // Check if it starts with "bytes "
        if !header.starts_with("bytes ") {
            return None;
        }

        // Remove "bytes " prefix
        let range_part = &header[6..];

        // Split by '/' to separate range from total
        let mut parts = range_part.split('/');
        let range_str = parts.next()?;
        let total_str = parts.next()?;

        // Parse total size
        let total = total_str.parse::<usize>().ok()?;

        // Parse range (start-end)
        let mut range_parts = range_str.split('-');
        let start = range_parts.next()?.parse::<usize>().ok()?;
        let end = range_parts.next()?.parse::<usize>().ok()?;

        // Validate range
        if start > end || end >= total {
            return None;
        }

        Some(Self { start, end, total })
    }

    fn from_header_value(header: Option<&HeaderValue>) -> Option<Self> {
        if header.is_none() {
            return None;
        }
        let result = header.unwrap().to_str();
        if result.is_err() {
            return None;
        }
        Self::from_str(result.unwrap())
    }
}

#[derive(Serialize)]
struct SftpUploadResponse {
    hash: String,
}

async fn sftp_upload(
    State(state): State<Arc<AppStateWrapper>>,
    Query(payload): Query<SftpFileUriPayload>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<SftpUploadResponse>, ApiErr> {
    info!("@sftp_upload {:?}", payload);

    let h_range = headers.get(header::CONTENT_RANGE);
    debug!("@sftp_upload content-range {:?}", h_range);

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
    debug!("@sftp_upload file opene");

    // set file size
    map_ssh_err!(
        file.set_metadata(FileAttributes {
            size: Some(file_size as u64),
            ..FileAttributes::empty()
        })
        .await
    )?;
    debug!("@sftp_upload file set size {}", file_size);

    if start > 0 {
        // seek to start
        map_ssh_err!(file.seek(SeekFrom::Start(start as u64)).await)?;
        debug!("@sftp_upload file seek {}", start);
    }

    let data = body.to_vec();
    if data.len() != range_len {
        return Err(ApiErr {
            code: ERR_CODE_SFTP_UPLOAD_INVALID_REQUEST,
            message: "body length not equal to range length".to_string(),
        });
    }

    let data = &data[0..range_len];
    map_ssh_err!(file.write_all(data).await)?;
    map_ssh_err!(file.flush().await)?;

    let hash = Sha256::digest(data);
    let hex_hash = hex::encode(hash);

    info!("@sftp_upload done {:?}", payload);

    Ok(Json(SftpUploadResponse { hash: hex_hash }))
}

#[derive(Debug)]
struct Range {
    start: usize,
    end: usize,
}

impl Range {
    fn from_str(header: &str) -> Option<Self> {
        // Range: bytes=0-1023
        let header = header.trim();

        // Check if it starts with "bytes="
        if !header.starts_with("bytes=") {
            return None;
        }

        // Remove "bytes=" prefix
        let range_str = &header[6..];

        // Parse range (start-end)
        let mut range_parts = range_str.split('-');
        let start = range_parts.next()?.parse::<usize>().ok()?;
        let end = range_parts.next()?.parse::<usize>().ok()?;

        // Validate range
        if start > end {
            return None;
        }

        Some(Self { start, end })
    }

    fn from_header_value(header: Option<&HeaderValue>) -> Option<Self> {
        if header.is_none() {
            return None;
        }
        let result = header.unwrap().to_str();
        if result.is_err() {
            return None;
        }
        Self::from_str(result.unwrap())
    }
}

async fn sftp_download(
    State(state): State<Arc<AppStateWrapper>>,
    Query(payload): Query<SftpFileUriPayload>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiErr> {
    info!("@sftp_download {:?}", payload);

    let h_range = headers.get(header::RANGE);
    debug!("@sftp_download range {:?}", h_range);

    let uri = parse_file_uri(payload.uri.as_str())?;
    let sftp = get_sftp_session(state, uri.target_id).await?;

    // read file metadata
    let attr = map_ssh_err!(sftp.metadata(uri.path).await)?;
    if attr.file_type() == FileType::Dir {
        return Err(ApiErr {
            code: ERR_CODE_SFTP_DOWNLOAD_INVALID_REQUEST,
            message: "file is a directory".to_string(),
        });
    }

    let file_name = uri.path.split('/').last().unwrap_or("");

    // set headers
    let mut headers = HeaderMap::new();
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}\"", file_name)
            .parse()
            .unwrap(),
    );

    let empty_bytes = Bytes::new();
    if attr.size.is_none() {
        return Ok((headers, empty_bytes));
    }

    let file_size = attr.size.unwrap() as usize;
    if file_size == 0 {
        return Ok((headers, empty_bytes));
    }

    let range = Range::from_header_value(h_range);
    let start: usize;
    let range_len;

    if range.is_some() {
        let range = range.unwrap();
        start = range.start;
        range_len = range.end - start + 1;

        if file_size <= range.end {
            return Err(ApiErr {
                code: ERR_CODE_SFTP_DOWNLOAD_INVALID_REQUEST,
                message: "range end exceed file size".to_string(),
            });
        }
    } else {
        start = 0;
        range_len = attr.size.unwrap() as usize;
    }

    // open file
    let mut file = map_ssh_err!(sftp.open(uri.path).await)?;

    if start > 0 {
        // seek to start
        map_ssh_err!(file.seek(SeekFrom::Start(start as u64)).await)?;
        debug!("@sftp_download file seek {}", start);
    }

    let mut buffer = vec![0; range_len];
    map_ssh_err!(file.read_exact(&mut buffer).await)?;

    let data = Bytes::from(buffer);

    debug!("@sftp_download done");

    Ok((headers, data))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sftp_file_uri_from_str() {
        let uri = "sftp:123:/path/to/file";
        let result = SftpFileUri::from_str(uri);
        assert!(
            result.is_some(),
            "@test_sftp_file_uri_from_str: parse fail. {uri}"
        );
        let sftp_uri = result.unwrap();
        assert_eq!(
            sftp_uri.target_id, 123,
            "@test_sftp_file_uri_from_str: parse target_id fail. {uri}"
        );
        assert_eq!(
            sftp_uri.path, "/path/to/file",
            "@test_sftp_file_uri_from_str: parse path fail. {uri}"
        );

        let uri = "ftp:123:/path/to/file";
        let result = SftpFileUri::from_str(uri);
        assert!(
            result.is_none(),
            "@test_sftp_file_uri_from_str: Invalid protocol. {uri}"
        );

        let uri = "sftp:abc:/path/to/file";
        let result = SftpFileUri::from_str(uri);
        assert!(
            result.is_none(),
            "@test_sftp_file_uri_from_str: Invalid target_id. {uri}"
        );

        let uri = "sftp:123:";
        let result = SftpFileUri::from_str(uri);
        assert!(
            result.is_none(),
            "@test_sftp_file_uri_from_str: Invalid path. {uri}"
        );

        let uri = "sftp:123:path/to/file";
        let result = SftpFileUri::from_str(uri);
        assert!(
            result.is_none(),
            "@test_sftp_file_uri_from_str: Invalid path. {uri}"
        );
    }

    #[test]
    fn test_mode_to_permissions() {
        assert_eq!(
            SftpFile::mode_to_permissions(0o777),
            "rwxrwxrwx",
            "@test_mode_to_permissions: 0o777 fail"
        );
        assert_eq!(
            SftpFile::mode_to_permissions(0o755),
            "rwxr-xr-x",
            "@test_mode_to_permissions: 0o755 fail"
        );
        assert_eq!(
            SftpFile::mode_to_permissions(0o700),
            "rwx------",
            "@test_mode_to_permissions: 0o700 fail"
        );
        assert_eq!(
            SftpFile::mode_to_permissions(0o666),
            "rw-rw-rw-",
            "@test_mode_to_permissions: 0o666 fail"
        );
        assert_eq!(
            SftpFile::mode_to_permissions(0o644),
            "rw-r--r--",
            "@test_mode_to_permissions: 0o644 fail"
        );
        assert_eq!(
            SftpFile::mode_to_permissions(0o444),
            "r--r--r--",
            "@test_mode_to_permissions: 0o444 fail"
        );
        assert_eq!(
            SftpFile::mode_to_permissions(0o222),
            "-w--w--w-",
            "@test_mode_to_permissions: 0o222 fail"
        );
        assert_eq!(
            SftpFile::mode_to_permissions(0o111),
            "--x--x--x",
            "@test_mode_to_permissions: 0o111 fail"
        );
        assert_eq!(
            SftpFile::mode_to_permissions(0o000),
            "---------",
            "@test_mode_to_permissions: 0o000 fail"
        );
    }

    #[test]
    fn test_split_path() {
        assert_eq!(
            SftpFile::split_path("/"),
            None,
            "@split_path: Root path should return None"
        );
        assert_eq!(
            SftpFile::split_path("a"),
            None,
            "@split_path: Path should starts with slash"
        );
        assert_eq!(
            SftpFile::split_path("/foo"),
            Some(("/", "foo")),
            "@split_path: /foo fail"
        );
        assert_eq!(
            SftpFile::split_path("/foo/bar"),
            Some(("/foo/", "bar")),
            "@split_path: /foo/bar fail"
        );
        assert_eq!(
            SftpFile::split_path("/foo/bar/"),
            Some(("/foo/", "bar")),
            "@split_path: /foo/bar/ fail"
        );
    }

    #[test]
    fn test_parse_stat_gnu() {
        let output = "/Users/xxx/Downloads/test,160,1720508748,1720508748,755,directory\n";
        let file = SftpFile::from_stat_gnu(output).unwrap();
        assert_eq!(file.name, "test", "@test_parse_stat_gnu: name fail");
        assert_eq!(
            file.r#type, 'd',
            "@test_parse_stat_gnu: type directory fail"
        );
        assert_eq!(file.size, Some(160), "@test_parse_stat_gnu: size fail");
        assert!(file.atime.is_some(), "@test_parse_stat_gnu: atime fail");
        assert!(file.mtime.is_some(), "@test_parse_stat_gnu: mtime fail");
        assert_eq!(
            file.permissions, "rwxr-xr-x",
            "@test_parse_stat_gnu: permissions fail"
        );

        let output = "/Users/xxx/Downloads/test/file,160,1720508748,1720508748,755,regular file\n";
        let file = SftpFile::from_stat_gnu(output).unwrap();
        assert_eq!(file.name, "file", "@test_parse_stat_gnu: name fail");
        assert_eq!(
            file.r#type, 'f',
            "@test_parse_stat_gnu: type regular file fail"
        );

        let output = "/Users/xxx/Downloads/test/file,160,1720508748,1720508748,755,symbolic link\n";
        let file = SftpFile::from_stat_gnu(output).unwrap();
        assert_eq!(
            file.r#type, 'l',
            "@test_parse_stat_gnu: type symbolic link fail"
        );

        let output =
            "/Use,rs/xxx/Downloads/tes,t/fi,le,160,1720508748,1720508748,755,symbolic link\n";
        let file = SftpFile::from_stat_gnu(output).unwrap();
        assert_eq!(
            file.name, "fi,le",
            "@test_parse_stat_gnu: file name with comma fail"
        );

        let output = "invalid,format";
        assert!(
            SftpFile::from_stat_gnu(output).is_err(),
            "@test_parse_stat_gnu: invalid format fail"
        );
    }

    #[test]
    fn test_parse_stat_bsd() {
        let output = "/Users/xxx/Downloads/test,160,1720508748,1720508748,drwxr-xr-x,Directory\n";
        let file = SftpFile::from_stat_bsd(output).unwrap();
        assert_eq!(file.name, "test", "@test_parse_stat_bsd: name fail");
        assert_eq!(
            file.r#type, 'd',
            "@test_parse_stat_bsd: type directory fail"
        );
        assert_eq!(file.size, Some(160), "@test_parse_stat_bsd: size fail");
        assert!(file.atime.is_some(), "@test_parse_stat_bsd: atime fail");
        assert!(file.mtime.is_some(), "@test_parse_stat_bsd: mtime fail");
        assert_eq!(
            file.permissions, "rwxr-xr-x",
            "@test_parse_stat_bsd: permissions fail"
        );

        let output =
            "/Users/xxx/Downloads/test/file,160,1720508748,1720508748,drwxr-xr-x,Regular File\n";
        let file = SftpFile::from_stat_bsd(output).unwrap();
        assert_eq!(file.name, "file", "@test_parse_stat_bsd: name fail");
        assert_eq!(
            file.r#type, 'f',
            "@test_parse_stat_bsd: type regular file fail"
        );

        let output =
            "/Users/xxx/Downloads/test/file,160,1720508748,1720508748,drwxr-xr-x,Symbolic Link\n";
        let file = SftpFile::from_stat_bsd(output).unwrap();
        assert_eq!(
            file.r#type, 'l',
            "@test_parse_stat_bsd: type symbolic link fail"
        );

        let output = "/Use,rs/xxx/Downloads/tes,t/fi,le,160,1720508748,1720508748,drwxr-xr-x,Symbolic Link\n";
        let file = SftpFile::from_stat_bsd(output).unwrap();
        assert_eq!(
            file.name, "fi,le",
            "@test_parse_stat_bsd: file name with comma fail"
        );

        let output = "invalid,format";
        assert!(
            SftpFile::from_stat_bsd(output).is_err(),
            "@test_parse_stat_bsd: invalid format fail"
        );
    }

    #[test]
    fn test_content_range_from_header() {
        // Valid Content-Range header
        let header = "bytes 0-1023/1024";
        let range = ContentRange::from_str(header).unwrap();
        assert_eq!(
            range.start, 0,
            "@test_content_range_from_header: start fail"
        );
        assert_eq!(range.end, 1023, "@test_content_range_from_header: end fail");
        assert_eq!(
            range.total, 1024,
            "@test_content_range_from_header: total fail"
        );

        // Valid Content-Range header with whitespace
        let header = "  bytes 200-299/1000  ";
        let range = ContentRange::from_str(header).unwrap();
        assert_eq!(
            range.start, 200,
            "@test_content_range_from_header: start with whitespace fail"
        );
        assert_eq!(
            range.end, 299,
            "@test_content_range_from_header: end with whitespace fail"
        );
        assert_eq!(
            range.total, 1000,
            "@test_content_range_from_header: total with whitespace fail"
        );

        // Valid single byte range
        let header = "bytes 0-0/1";
        let range = ContentRange::from_str(header).unwrap();
        assert_eq!(
            range.start, 0,
            "@test_content_range_from_header: single byte start fail"
        );
        assert_eq!(
            range.end, 0,
            "@test_content_range_from_header: single byte end fail"
        );
        assert_eq!(
            range.total, 1,
            "@test_content_range_from_header: single byte total fail"
        );
    }
}
