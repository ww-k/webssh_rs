use std::sync::Arc;

use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::{consts::services_err_code::*, entities::target::TargetAuthMethod};

use super::{ApiErr, ValidJson};

pub(crate) fn svc_sftp_router_builder(app_state: Arc<AppState>) -> Router {
    Router::new()
        .route("/ls", get(sftp_ls))
        .route("/mkdir", post(sftp_mkdir))
        .route("/stat", get(sftp_stat))
        .route("/upload", post(sftp_upload))
        .route("/download", get(sftp_download))
        .fallback(|| async { "not supported" })
        .with_state(app_state)
}

#[derive(Serialize, Debug)]
struct IFile {
    name: String,
    size: u64,
    mode: u16,
    mtime: i64,
    atime: i64,
}

#[derive(Deserialize)]
struct SftpFileUriPayload {
    uri: String,
}

async fn sftp_ls(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<SftpFileUriPayload>,
) -> Result<Json<Vec<IFile>>, ApiErr> {
    let mut files = Vec::<IFile>::new();
    files.push(IFile {
        name: "test".to_string(),
        size: 0,
        mode: 0,
        mtime: 0,
        atime: 0,
    });
    Ok(Json(files))
}

async fn sftp_mkdir(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<SftpFileUriPayload>,
) -> Result<Json<IFile>, ApiErr> {
    let file = IFile {
        name: "test".to_string(),
        size: 0,
        mode: 0,
        mtime: 0,
        atime: 0,
    };
    Ok(Json(file))
}

async fn sftp_stat(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<SftpFileUriPayload>,
) -> Result<Json<IFile>, ApiErr> {
    let file = IFile {
        name: "test".to_string(),
        size: 0,
        mode: 0,
        mtime: 0,
        atime: 0,
    };
    Ok(Json(file))
}

async fn sftp_upload(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<SftpFileUriPayload>,
) -> Result<Json<Vec<IFile>>, ApiErr> {
    todo!();
}

async fn sftp_download(
    State(state): State<Arc<AppState>>,
    ValidJson(payload): ValidJson<SftpFileUriPayload>,
) -> Result<Json<Vec<IFile>>, ApiErr> {
    todo!();
}
