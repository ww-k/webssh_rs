use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

#[derive(Debug, Deserialize, IntoParams)]
pub struct FsPathPayload {
    /// 本机文件路径。传 / 时返回本机根目录/盘符入口。
    pub path: String,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct FsRenamePayload {
    /// 源路径
    pub path: String,
    /// 目标路径
    pub target_path: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FsFile {
    pub name: String,
    pub path: String,
    pub r#type: char,
    pub size: Option<u64>,
    pub atime: Option<u64>,
    pub mtime: Option<u64>,
    pub permissions: String,
}
