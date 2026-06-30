use axum::http::HeaderValue;
use russh_sftp::{
    client::fs::DirEntry,
    protocol::{FileAttributes, FileType},
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

#[derive(Debug, Deserialize, IntoParams)]
pub struct QueryTargetId {
    /// SSH 目标 ID
    pub target_id: i32,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct SftpLsPayload {
    /// SFTP 文件 URI，格式：sftp://target_id/path
    pub uri: String,
    /// 是否显示所有文件（包括隐藏文件）
    pub all: Option<bool>,
}

#[derive(Serialize, ToSchema)]
pub struct SftpFile {
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

impl SftpFile {
    pub(crate) fn from_dir_entry(dir_entry: DirEntry) -> Self {
        let attrs = dir_entry.metadata();
        Self::from_name_attrs(dir_entry.file_name(), attrs)
    }

    pub(crate) fn from_name_attrs(name: String, attrs: FileAttributes) -> Self {
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

#[derive(Debug, Deserialize, IntoParams)]
pub struct SftpFileUriPayload {
    /// SFTP 文件 URI，格式：sftp://target_id/path
    pub uri: String,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct SftpRenamePayload {
    /// 源文件 URI
    pub uri: String,
    /// 目标路径
    pub target_path: String,
}

#[derive(Debug)]
pub(crate) struct ContentRange {
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) total: usize,
}

impl ContentRange {
    pub(crate) fn from_str(header: &str) -> Option<Self> {
        let header = header.trim();
        if !header.starts_with("bytes ") {
            return None;
        }

        let range_part = &header[6..];
        let mut parts = range_part.split('/');
        let range_str = parts.next()?;
        let total_str = parts.next()?;
        let total = total_str.parse::<usize>().ok()?;

        let mut range_parts = range_str.split('-');
        let start = range_parts.next()?.parse::<usize>().ok()?;
        let end = range_parts.next()?.parse::<usize>().ok()?;

        if start > end || end >= total {
            return None;
        }

        Some(Self { start, end, total })
    }

    pub(crate) fn from_header_value(header: Option<&HeaderValue>) -> Option<Self> {
        let header = header?;
        Self::from_str(header.to_str().ok()?)
    }
}

#[derive(Debug)]
pub(crate) struct Range {
    pub(crate) start: usize,
    pub(crate) end: usize,
}

impl Range {
    pub(crate) fn from_str(header: &str) -> Option<Self> {
        let header = header.trim();
        if !header.starts_with("bytes=") {
            return None;
        }

        let range_str = &header[6..];
        let mut range_parts = range_str.split('-');
        let start = range_parts.next()?.parse::<usize>().ok()?;
        let end = range_parts.next()?.parse::<usize>().ok()?;

        if start > end {
            return None;
        }

        Some(Self { start, end })
    }

    pub(crate) fn from_header_value(header: Option<&HeaderValue>) -> Option<Self> {
        let header = header?;
        Self::from_str(header.to_str().ok()?)
    }
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct SftpUploadResponse {
    pub hash: String,
}
