use std::sync::Arc;

use axum::{
    Json, Router,
    body::Bytes,
    extract::{Query, State},
    http::header,
    response::IntoResponse,
    routing::{get, post},
};
use russh_sftp::{client::SftpSession, protocol};
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

use crate::consts::services_err_code::*;
use crate::{AppState, entities::target, ssh_session_pool::SshSessionPool};

use super::ApiErr;

struct AppStateWrapper {
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
        .route("/upload", post(sftp_upload))
        .route("/download", post(sftp_download))
        .fallback(|| async { "not supported" })
        .with_state(Arc::new(AppStateWrapper {
            app_state,
            session_pool,
        }))
}

#[derive(Debug, Clone, Serialize)]
pub struct SftpFile {
    pub name: String,
    pub attrs: protocol::FileAttributes,
}

#[derive(Debug, Deserialize)]
struct SftpFileUriPayload {
    uri: String,
}

struct SftpFileUri {
    target_id: i32,
    path: String,
}

impl SftpFileUri {
    fn from_str(str: &str) -> Option<Self> {
        let mut split = str.split(":");
        if Some("sftp") != split.next() {
            return None;
        }
        let target_id_str = split.next();
        let target_id = match target_id_str {
            Some(id) => id.parse::<i32>().ok()?,
            None => return None,
        };
        let path = split.collect::<Vec<_>>().join(":");
        // let offset = 6 + target_id_str.unwrap().len();
        // let path = str[offset..].to_string();

        Some(SftpFileUri {
            target_id,
            path,
        })
    }
}

struct SftpSvcSession {}

async fn get_sftp_session(state: Arc<AppStateWrapper>, target_id: i32) -> anyhow::Result<SftpSession> {
    let result = state.session_pool.get(target_id).await;
    if result.is_err() {
        return Err(result.err().unwrap());
    }
    let channel = result.unwrap().take_channel().unwrap();
    let result = channel.request_subsystem(true, "sftp").await;
    if result.is_err() {
        anyhow::bail!(result.err().unwrap().to_string());
    }
    let sftp = SftpSession::new(channel.into_stream()).await;
    if result.is_err() {
        anyhow::bail!(result.err().unwrap().to_string());
    }
    Ok(sftp.ok().unwrap())
}

async fn sftp_ls(
    State(state): State<Arc<AppStateWrapper>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<Json<Vec<SftpFile>>, ApiErr> {
    debug!("@sftp_ls {:?}", payload);

    let sftp_file_uri = SftpFileUri::from_str(payload.uri.as_str());
    if sftp_file_uri.is_none() {
        return Err(ApiErr {
            code: ERR_CODE_SFTP_INVALID_URI,
            message: "invalid uri".to_string(),
        });
    }
    let sftp_file_uri = sftp_file_uri.unwrap();

    let sftp = match get_sftp_session(state, sftp_file_uri.target_id).await {
        Ok(value) => value,
        Err(value) => {
            return Err(ApiErr {
                code: ERR_CODE_SSH_ERR,
                message: value.to_string(),
            });
        }
    };
    let result = sftp.read_dir(sftp_file_uri.path).await;
    if result.is_err() {
        return Err(ApiErr {
            code: ERR_CODE_SSH_ERR,
            message: result.err().unwrap().to_string(),
        });
    }

    debug!("@sftp_ls sftp.read_dir {:?}", payload);

    let files = result.unwrap().map(|dir_entry| {
        SftpFile {
            name: dir_entry.file_name(),
            attrs: dir_entry.metadata(),
        }
    });

    Ok(Json(Vec::from_iter(files)))
}

async fn sftp_mkdir(
    State(state): State<Arc<AppStateWrapper>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<Json<SftpFile>, ApiErr> {
    let file = SftpFile {
        name: "test".to_string(),
        attrs: protocol::FileAttributes::default(),
    };
    Ok(Json(file))
}

async fn sftp_stat(
    State(state): State<Arc<AppStateWrapper>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<Json<SftpFile>, ApiErr> {
    let file = SftpFile {
        name: "test".to_string(),
        attrs: protocol::FileAttributes::default(),
    };
    Ok(Json(file))
}

async fn sftp_upload(
    State(state): State<Arc<AppStateWrapper>>,
    Query(payload): Query<SftpFileUriPayload>,
    content: Bytes,
) -> Result<Json<Vec<SftpFile>>, ApiErr> {
    todo!();
}

async fn sftp_download(
    State(state): State<Arc<AppStateWrapper>>,
    Query(payload): Query<SftpFileUriPayload>,
) -> Result<impl IntoResponse, ApiErr> {
    let data = Bytes::from("Hello, this is binary data");
    // 设置响应头
    let headers = [
        // 设置内容类型
        (header::CONTENT_TYPE, "application/octet-stream"),
        // 设置内容处置，指定文件名
        (
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"file.txt\"",
        ),
    ];

    Ok((headers, data))
}
