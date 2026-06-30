use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

#[derive(Debug, Deserialize, IntoParams)]
pub struct FsFileUriPayload {
    /// 本机文件路径，使用 Unix 风格路径分隔符
    pub uri: String,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct FsLsPayload {
    /// 本机文件路径，使用 Unix 风格路径分隔符。传 / 时返回本机根目录/盘符入口。
    pub uri: String,
    /// 是否显示所有文件（包括隐藏文件）
    pub all: Option<bool>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct FsRenamePayload {
    /// 源文件 URI
    pub uri: String,
    /// 目标路径
    pub target_path: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FsFile {
    /// 文件名
    pub name: String,
    /// 文件类型：f-文件，d-目录，l-符号链接，?-未知
    pub r#type: char,
    /// 文件大小（字节）
    pub size: Option<u64>,
    /// 最后访问时间
    pub atime: Option<u32>,
    /// 最后修改时间
    pub mtime: Option<u32>,
    /// 权限字符串
    pub permissions: String,
}
