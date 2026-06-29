use crate::apis::ApiErr;

use super::ranges::invalid_task;

#[derive(Debug)]
pub struct SftpUri<'a> {
    pub target_id: i32,
    pub path: &'a str,
}

pub fn parse_sftp_uri(uri: &str) -> Result<SftpUri<'_>, ApiErr> {
    let mut split = uri.split(':');
    if split.next() != Some("sftp") {
        return Err(invalid_task("invalid sftp uri"));
    }
    let Some(target_id_str) = split.next() else {
        return Err(invalid_task("invalid sftp uri"));
    };
    let target_id = target_id_str
        .parse::<i32>()
        .map_err(|_| invalid_task("invalid sftp target id"))?;
    let offset = 6 + target_id_str.len();
    let path = uri
        .get(offset..)
        .ok_or_else(|| invalid_task("invalid sftp uri"))?;
    if !path.starts_with('/') {
        return Err(invalid_task("invalid sftp uri path"));
    }
    Ok(SftpUri { target_id, path })
}

pub fn file_name_from_path(path: &str) -> String {
    path.trim_end_matches('/')
        .split('/')
        .last()
        .unwrap_or("")
        .to_string()
}
