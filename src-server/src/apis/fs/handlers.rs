use axum::{Json, extract::Query};

use crate::apis::{ApiErr, InternalErrorResponse};

use super::{
    dto::{FsFile, FsFileUriPayload, FsLsPayload, FsRenamePayload},
    service,
};

#[utoipa::path(
    get,
    path = "/api/fs/ls",
    tag = "fs",
    summary = "列出本机文件",
    description = "获取指定目录下的本机文件和文件夹列表，可选择是否显示隐藏文件",
    params(FsLsPayload),
    responses(
        (status = 200, description = "成功获取本机文件列表", body = Vec<FsFile>),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn ls(Query(payload): Query<FsLsPayload>) -> Result<Json<Vec<FsFile>>, ApiErr> {
    Ok(Json(service::list(&payload.uri, payload.all).await?))
}

#[utoipa::path(
    get,
    path = "/api/fs/home",
    tag = "fs",
    summary = "获取本机主目录路径",
    description = "获取本机用户主目录路径，获取不到时返回根目录",
    responses(
        (status = 200, description = "成功获取本机主目录路径", body = String),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn home() -> Result<String, ApiErr> {
    Ok(service::home())
}

#[utoipa::path(
    get,
    path = "/api/fs/stat",
    tag = "fs",
    summary = "获取本机文件信息",
    description = "获取指定文件的详细元数据信息，包括大小、权限、修改时间等",
    params(FsFileUriPayload),
    responses(
        (status = 200, description = "成功获取本机文件信息", body = FsFile),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn stat(Query(payload): Query<FsFileUriPayload>) -> Result<Json<FsFile>, ApiErr> {
    Ok(Json(service::stat(&payload.uri).await?))
}

#[utoipa::path(
    post,
    path = "/api/fs/mkdir",
    tag = "fs",
    summary = "创建本机目录",
    description = "在指定路径创建新目录",
    params(FsFileUriPayload),
    responses(
        (status = 200, description = "成功创建本机目录"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn mkdir(Query(payload): Query<FsFileUriPayload>) -> Result<(), ApiErr> {
    service::mkdir(&payload.uri).await
}

#[utoipa::path(
    post,
    path = "/api/fs/cp",
    tag = "fs",
    summary = "复制本机文件",
    description = "复制本机文件到指定位置",
    params(FsRenamePayload),
    responses(
        (status = 200, description = "成功复制本机文件"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn cp(Query(payload): Query<FsRenamePayload>) -> Result<(), ApiErr> {
    service::cp(payload).await
}

#[utoipa::path(
    post,
    path = "/api/fs/rename",
    tag = "fs",
    summary = "重命名本机文件",
    description = "重命名本机文件或将文件移动到新位置",
    params(FsRenamePayload),
    responses(
        (status = 200, description = "成功重命名本机文件"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn rename(Query(payload): Query<FsRenamePayload>) -> Result<(), ApiErr> {
    service::rename(payload).await
}

#[utoipa::path(
    post,
    path = "/api/fs/rm",
    tag = "fs",
    summary = "删除本机文件或空目录",
    description = "删除指定的本机文件或空目录",
    params(FsFileUriPayload),
    responses(
        (status = 200, description = "成功删除本机文件或空目录"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn rm(Query(payload): Query<FsFileUriPayload>) -> Result<(), ApiErr> {
    service::rm(&payload.uri).await
}

#[utoipa::path(
    post,
    path = "/api/fs/rm/rf",
    tag = "fs",
    summary = "递归删除本机文件或目录",
    description = "递归删除指定的本机文件或目录及其所有子内容",
    params(FsFileUriPayload),
    responses(
        (status = 200, description = "成功递归删除本机文件或目录"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn rm_rf(Query(payload): Query<FsFileUriPayload>) -> Result<(), ApiErr> {
    service::rm_rf(&payload.uri).await
}
