pub mod cp;
pub mod download;
pub mod home;
pub mod ls;
pub mod mkdir;
pub mod rename;
pub mod rm;
pub mod rm_rf;
pub mod stat;
pub mod upload;

use axum::http::HeaderValue;
use russh_sftp::{
    client::fs::DirEntry,
    protocol::{FileAttributes, FileType},
};
use serde::{Deserialize, Serialize};

use crate::{apis::ApiErr, consts::services_err_code::*};

const URI_SEP: &str = ":";
const PATH_SEP: &str = "/";

#[derive(Serialize)]
pub struct SftpFile {
    name: String,
    r#type: char,
    size: Option<u64>,
    atime: Option<u32>,
    mtime: Option<u32>,
    permissions: String,
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
pub struct SftpFileUriPayload {
    uri: String,
}

#[derive(Debug, Deserialize)]
pub struct SftpRenamePayload {
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

fn parse_file_uri(file_uri_str: &str) -> Result<SftpFileUri<'_>, ApiErr> {
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

#[allow(dead_code)]
fn mode_to_permissions(mode: u32) -> String {
    let mut s = String::with_capacity(9);
    let perms = ['r', 'w', 'x'];

    for i in (0..3).rev() {
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

#[allow(dead_code)]
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
            mode_to_permissions(0o777),
            "rwxrwxrwx",
            "@test_mode_to_permissions: 0o777 fail"
        );
        assert_eq!(
            mode_to_permissions(0o755),
            "rwxr-xr-x",
            "@test_mode_to_permissions: 0o755 fail"
        );
        assert_eq!(
            mode_to_permissions(0o700),
            "rwx------",
            "@test_mode_to_permissions: 0o700 fail"
        );
        assert_eq!(
            mode_to_permissions(0o666),
            "rw-rw-rw-",
            "@test_mode_to_permissions: 0o666 fail"
        );
        assert_eq!(
            mode_to_permissions(0o644),
            "rw-r--r--",
            "@test_mode_to_permissions: 0o644 fail"
        );
        assert_eq!(
            mode_to_permissions(0o444),
            "r--r--r--",
            "@test_mode_to_permissions: 0o444 fail"
        );
        assert_eq!(
            mode_to_permissions(0o222),
            "-w--w--w-",
            "@test_mode_to_permissions: 0o222 fail"
        );
        assert_eq!(
            mode_to_permissions(0o111),
            "--x--x--x",
            "@test_mode_to_permissions: 0o111 fail"
        );
        assert_eq!(
            mode_to_permissions(0o000),
            "---------",
            "@test_mode_to_permissions: 0o000 fail"
        );
    }

    #[test]
    fn test_split_path() {
        assert_eq!(
            split_path("/"),
            None,
            "@split_path: Root path should return None"
        );
        assert_eq!(
            split_path("a"),
            None,
            "@split_path: Path should starts with slash"
        );
        assert_eq!(
            split_path("/foo"),
            Some(("/", "foo")),
            "@split_path: /foo fail"
        );
        assert_eq!(
            split_path("/foo/bar"),
            Some(("/foo/", "bar")),
            "@split_path: /foo/bar fail"
        );
        assert_eq!(
            split_path("/foo/bar/"),
            Some(("/foo/", "bar")),
            "@split_path: /foo/bar/ fail"
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
