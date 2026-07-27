use axum::{Json, extract::Query};

use crate::apis::{ApiErr, InternalErrorResponse};

use super::{
    dto::{FsFile, FsFileUriPayload, FsLsPayload, FsRenamePayload, FsUserDir},
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
    path = "/api/fs/user-dirs/home",
    tag = "fs",
    summary = "获取本机主目录路径",
    description = "获取本机用户主目录路径，获取不到时返回根目录",
    responses(
        (status = 200, description = "成功获取本机主目录路径", body = String),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn user_dir_home() -> Result<String, ApiErr> {
    Ok(service::user_dir_home())
}

#[utoipa::path(
    get,
    path = "/api/fs/user-dirs/download",
    tag = "fs",
    summary = "获取本机下载目录路径",
    description = "获取操作系统配置的本机用户下载目录路径，获取不到时返回用户主目录",
    responses(
        (status = 200, description = "成功获取本机下载目录路径", body = String),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn user_dir_download() -> Result<String, ApiErr> {
    Ok(service::user_dir_download())
}

#[utoipa::path(
    get,
    path = "/api/fs/user-dirs",
    tag = "fs",
    summary = "获取本机用户目录",
    description = "获取本机根目录、用户主目录及操作系统配置的桌面、文档和下载目录",
    responses(
        (status = 200, description = "成功获取本机用户目录", body = Vec<FsUserDir>),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn user_dirs() -> Result<Json<Vec<FsUserDir>>, ApiErr> {
    Ok(Json(service::user_dirs()))
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

#[utoipa::path(
    post,
    path = "/api/fs/show-in-folder",
    tag = "fs",
    summary = "在系统文件管理器中显示本机文件",
    description = "macOS 使用 Finder 定位文件，Windows 使用文件资源管理器定位文件，Linux 打开文件所在目录",
    params(FsFileUriPayload),
    responses(
        (status = 200, description = "成功启动系统文件管理器"),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub async fn show_in_folder(Query(payload): Query<FsFileUriPayload>) -> Result<(), ApiErr> {
    service::show_in_folder(&payload.uri).await
}
