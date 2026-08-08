use std::collections::HashSet;

use tracing::debug;

use crate::{
    apis::ApiErr,
    consts::services_err_code::*,
    map_ssh_err,
    sftp_client::{FastSftpClient, SftpFileType},
    ssh_connection_pool::{ChannelMode, SshConnectionPool},
};

use super::dto::SftpUserDir;

const URI_SEP: &str = ":";
const PATH_SEP: &str = "/";

pub(crate) async fn discover_user_dirs(
    connection_pool: &SshConnectionPool,
    target_id: i32,
) -> Result<Vec<SftpUserDir>, ApiErr> {
    let sftp = map_ssh_err!(connection_pool.sftp(target_id, ChannelMode::Shared).await)?;
    let home = resolve_user_dir_home(&sftp).await?;
    let entries = map_ssh_err!(sftp.read_dir(&home).await)?;
    let available_dirs = entries
        .into_iter()
        .filter_map(|entry| {
            let (name, attrs) = entry.into_parts();
            (attrs.file_type() == SftpFileType::Dir).then_some(name)
        })
        .collect::<HashSet<_>>();

    Ok(user_dirs_from_home(&home, &available_dirs))
}

pub(crate) async fn resolve_user_dir_home(sftp: &FastSftpClient) -> Result<String, ApiErr> {
    match sftp.realpath(".").await {
        Ok(path) => Ok(normalize_user_dir_home(&path)),
        Err(err) if err.is_operation_unsupported() => {
            debug!("SFTP REALPATH is unsupported, falling back to root");
            Ok(PATH_SEP.to_string())
        }
        Err(err) => Err(ApiErr {
            code: ERR_CODE_SSH_ERR,
            message: err.to_string(),
        }),
    }
}

pub(crate) fn normalize_user_dir_home(path: &str) -> String {
    let path = path.trim().replace('\\', PATH_SEP);
    let path = path.trim_end_matches(PATH_SEP);
    if path.is_empty() {
        PATH_SEP.to_string()
    } else if path.starts_with(PATH_SEP) {
        path.to_string()
    } else {
        format!("/{path}")
    }
}

pub(crate) fn user_dirs_from_home(
    home: &str,
    available_dirs: &HashSet<String>,
) -> Vec<SftpUserDir> {
    let home = normalize_user_dir_home(home);
    let child_path = |name: &str| {
        if home == PATH_SEP {
            format!("/{name}")
        } else {
            format!("{home}/{name}")
        }
    };

    let mut user_dirs = vec![
        SftpUserDir {
            name: "/".to_string(),
            path: "/".to_string(),
        },
        SftpUserDir {
            name: "Home".to_string(),
            path: home.clone(),
        },
    ];

    for name in ["Desktop", "Documents", "Downloads"] {
        if available_dirs.contains(name) {
            user_dirs.push(SftpUserDir {
                name: name.to_string(),
                path: child_path(name),
            });
        }
    }

    let mut seen_paths = HashSet::new();
    user_dirs.retain(|dir| seen_paths.insert(dir.path.clone()));
    user_dirs
}

#[derive(Debug)]
pub(crate) struct SftpFileUri<'a> {
    pub(crate) target_id: i32,
    pub(crate) path: &'a str,
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

        if path.len() > PATH_SEP.len() && path.ends_with(PATH_SEP) {
            path = &path[..path.len() - 1];
        }

        Some(SftpFileUri { target_id, path })
    }
}

pub(crate) fn parse_file_uri(file_uri_str: &str) -> Result<SftpFileUri<'_>, ApiErr> {
    let uri = SftpFileUri::from_str(file_uri_str);
    uri.ok_or(ApiErr {
        code: ERR_CODE_SFTP_INVALID_URI,
        message: "invalid uri".to_string(),
    })
}

pub(crate) fn get_file_name(path: &str) -> String {
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
    use crate::apis::sftp::dto::ContentRange;

    #[test]
    fn normalize_user_dir_home_uses_posix_path_format() {
        assert_eq!(
            normalize_user_dir_home(r"C:\Users\kevin\"),
            "/C:/Users/kevin"
        );
        assert_eq!(normalize_user_dir_home("/home/user/"), "/home/user");
        assert_eq!(normalize_user_dir_home(""), "/");
    }

    #[test]
    fn user_dirs_include_existing_directories_in_display_order() {
        let available_dirs = HashSet::from([
            "Downloads".to_string(),
            "Desktop".to_string(),
            "Documents".to_string(),
        ]);
        let dirs = user_dirs_from_home("/home/user/", &available_dirs);

        assert_eq!(
            dirs.iter()
                .map(|dir| (dir.name.as_str(), dir.path.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("/", "/"),
                ("Home", "/home/user"),
                ("Desktop", "/home/user/Desktop"),
                ("Documents", "/home/user/Documents"),
                ("Downloads", "/home/user/Downloads"),
            ]
        );
    }

    #[test]
    fn user_dirs_skip_missing_directories() {
        let available_dirs = HashSet::from(["Downloads".to_string()]);
        let dirs = user_dirs_from_home("/home/user", &available_dirs);

        assert_eq!(
            dirs.iter().map(|dir| dir.name.as_str()).collect::<Vec<_>>(),
            vec!["/", "Home", "Downloads"]
        );
    }

    #[test]
    fn user_dirs_deduplicate_home_when_home_is_root() {
        let available_dirs = HashSet::from(["Desktop".to_string()]);
        let dirs = user_dirs_from_home("/", &available_dirs);

        assert_eq!(
            dirs.iter()
                .map(|dir| (dir.name.as_str(), dir.path.as_str()))
                .collect::<Vec<_>>(),
            vec![("/", "/"), ("Desktop", "/Desktop")]
        );
    }

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

        let uri = "sftp:123:/";
        let result = SftpFileUri::from_str(uri);
        assert!(
            result.is_some(),
            "@test_sftp_file_uri_from_str: parse root path fail. {uri}"
        );
        let sftp_uri = result.unwrap();
        assert_eq!(
            sftp_uri.path, "/",
            "@test_sftp_file_uri_from_str: parse root path fail. {uri}"
        );

        let uri = "sftp:123:/path/to/dir/";
        let result = SftpFileUri::from_str(uri);
        assert!(
            result.is_some(),
            "@test_sftp_file_uri_from_str: parse trailing slash fail. {uri}"
        );
        let sftp_uri = result.unwrap();
        assert_eq!(
            sftp_uri.path, "/path/to/dir",
            "@test_sftp_file_uri_from_str: trim trailing slash fail. {uri}"
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
