use std::{
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use tokio::fs;

use crate::{
    apis::ApiErr,
    consts::services_err_code::{ERR_CODE_FS_INVALID_REQUEST, ERR_CODE_FS_IO_ERR},
};

use super::dto::{FsFile, FsRenamePayload};

pub async fn list(path: &str, all: Option<bool>) -> Result<Vec<FsFile>, ApiErr> {
    if should_list_roots(path) {
        return list_roots().await;
    }

    list_dir(path, all).await
}

pub fn home() -> String {
    home_from_env(
        std::env::var("HOME").ok(),
        std::env::var("USERPROFILE").ok(),
    )
}

fn home_from_env(home: Option<String>, userprofile: Option<String>) -> String {
    home.or(userprofile)
        .filter(|path| !path.is_empty())
        .unwrap_or_else(|| "/".to_string())
}

async fn list_dir(path: &str, all: Option<bool>) -> Result<Vec<FsFile>, ApiErr> {
    let mut entries = fs::read_dir(path).await.map_err(map_fs_io_err)?;
    let mut files = Vec::new();

    while let Some(entry) = entries.next_entry().await.map_err(map_fs_io_err)? {
        let path = entry.path();
        let metadata = entry.metadata().await.map_err(map_fs_io_err)?;
        if !all.unwrap_or(false) && is_hidden_path(&path, &metadata) {
            continue;
        }

        files.push(fs_file_from_metadata(path, metadata));
    }

    files.sort_by(|a, b| match (a.r#type, b.r#type) {
        ('d', 'd') => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        ('d', _) => std::cmp::Ordering::Less,
        (_, 'd') => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(files)
}

pub async fn stat(path: &str) -> Result<FsFile, ApiErr> {
    let path = PathBuf::from(path);
    let metadata = fs::metadata(&path).await.map_err(map_fs_io_err)?;
    Ok(fs_file_from_metadata(path, metadata))
}

pub async fn mkdir(path: &str) -> Result<(), ApiErr> {
    fs::create_dir_all(path).await.map_err(map_fs_io_err)
}

pub async fn cp(payload: FsRenamePayload) -> Result<(), ApiErr> {
    let metadata = fs::metadata(&payload.uri).await.map_err(map_fs_io_err)?;
    if metadata.is_dir() {
        return Err(ApiErr {
            code: ERR_CODE_FS_INVALID_REQUEST,
            message: "copy directory is not supported".to_string(),
        });
    }
    fs::copy(payload.uri, &payload.target_path)
        .await
        .map_err(map_fs_io_err)?;
    Ok(())
}

pub async fn rename(payload: FsRenamePayload) -> Result<(), ApiErr> {
    fs::rename(payload.uri, &payload.target_path)
        .await
        .map_err(map_fs_io_err)
}

pub async fn rm(path: &str) -> Result<(), ApiErr> {
    let metadata = fs::metadata(path).await.map_err(map_fs_io_err)?;
    if metadata.is_dir() {
        fs::remove_dir(path).await.map_err(map_fs_io_err)
    } else {
        fs::remove_file(path).await.map_err(map_fs_io_err)
    }
}

pub async fn rm_rf(path: &str) -> Result<(), ApiErr> {
    let metadata = fs::metadata(path).await.map_err(map_fs_io_err)?;
    if metadata.is_dir() {
        fs::remove_dir_all(path).await.map_err(map_fs_io_err)
    } else {
        fs::remove_file(path).await.map_err(map_fs_io_err)
    }
}

async fn list_roots() -> Result<Vec<FsFile>, ApiErr> {
    let mut roots = Vec::new();
    for letter in b'A'..=b'Z' {
        let path = format!("{}:\\", letter as char);
        if std::path::Path::new(&path).exists() {
            roots.push(FsFile {
                name: path.clone(),
                r#type: 'd',
                size: None,
                atime: None,
                mtime: None,
                permissions: "".to_string(),
            });
        }
    }
    Ok(roots)
}

#[cfg(windows)]
fn should_list_roots(path: &str) -> bool {
    path == "/"
}

#[cfg(not(windows))]
fn should_list_roots(_path: &str) -> bool {
    false
}

fn fs_file_from_metadata(path: PathBuf, metadata: std::fs::Metadata) -> FsFile {
    let name = file_name(&path);
    FsFile {
        name,
        r#type: if metadata.is_dir() {
            'd'
        } else if metadata.is_file() {
            'f'
        } else if metadata.file_type().is_symlink() {
            'l'
        } else {
            '?'
        },
        size: Some(metadata.len()),
        atime: metadata
            .accessed()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .and_then(|duration| u32::try_from(duration.as_secs()).ok()),
        mtime: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .and_then(|duration| u32::try_from(duration.as_secs()).ok()),
        permissions: permissions_to_string(&metadata),
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn has_dot_hidden_name(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with('.'))
}

#[cfg(windows)]
fn is_hidden_path(path: &Path, metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;

    has_dot_hidden_name(path) || metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
}

#[cfg(not(windows))]
fn is_hidden_path(path: &Path, _metadata: &std::fs::Metadata) -> bool {
    has_dot_hidden_name(path)
}

#[cfg(unix)]
fn permissions_to_string(metadata: &std::fs::Metadata) -> String {
    use std::os::unix::fs::PermissionsExt;
    format!("{:o}", metadata.permissions().mode() & 0o777)
}

#[cfg(not(unix))]
fn permissions_to_string(metadata: &std::fs::Metadata) -> String {
    if metadata.permissions().readonly() {
        "readonly".to_string()
    } else {
        "".to_string()
    }
}

fn map_fs_io_err(err: std::io::Error) -> ApiErr {
    ApiErr {
        code: ERR_CODE_FS_IO_ERR,
        message: err.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::list;
    use tokio::fs;

    #[cfg(unix)]
    #[tokio::test]
    async fn list_root_returns_root_directory_entries() {
        let files = list("/", None).await.unwrap();

        assert!(files.iter().all(|file| file.name != "/"));
        assert!(files.iter().any(|file| file.name == "tmp"));
    }

    #[tokio::test]
    async fn list_filters_hidden_files_by_default() {
        let dir = create_test_dir("list_filters_hidden_files_by_default").await;
        let visible_path = dir.join("visible.txt");
        let hidden_path = dir.join(".hidden.txt");

        fs::write(&visible_path, "").await.unwrap();
        fs::write(&hidden_path, "").await.unwrap();

        let files = list(dir.to_str().unwrap(), None).await.unwrap();

        assert!(files.iter().any(|file| file.name == "visible.txt"));
        assert!(!files.iter().any(|file| file.name == ".hidden.txt"));

        fs::remove_dir_all(dir).await.unwrap();
    }

    #[tokio::test]
    async fn list_returns_hidden_files_when_all_is_true() {
        let dir = create_test_dir("list_returns_hidden_files_when_all_is_true").await;
        let visible_path = dir.join("visible.txt");
        let hidden_path = dir.join(".hidden.txt");

        fs::write(&visible_path, "").await.unwrap();
        fs::write(&hidden_path, "").await.unwrap();

        let files = list(dir.to_str().unwrap(), Some(true)).await.unwrap();

        assert!(files.iter().any(|file| file.name == "visible.txt"));
        assert!(files.iter().any(|file| file.name == ".hidden.txt"));

        fs::remove_dir_all(dir).await.unwrap();
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn list_filters_windows_hidden_attribute_by_default() {
        let dir = create_test_dir("list_filters_windows_hidden_attribute_by_default").await;
        let visible_path = dir.join("visible.txt");
        let hidden_path = dir.join("hidden.txt");

        fs::write(&visible_path, "").await.unwrap();
        fs::write(&hidden_path, "").await.unwrap();
        set_windows_hidden_attribute(&hidden_path);

        let files = list(dir.to_str().unwrap(), None).await.unwrap();

        assert!(files.iter().any(|file| file.name == "visible.txt"));
        assert!(!files.iter().any(|file| file.name == "hidden.txt"));

        let all_files = list(dir.to_str().unwrap(), Some(true)).await.unwrap();

        assert!(all_files.iter().any(|file| file.name == "hidden.txt"));

        fs::remove_dir_all(dir).await.unwrap();
    }

    #[test]
    fn home_returns_root_when_home_env_is_missing() {
        assert_eq!(super::home_from_env(None, None), "/");
    }

    #[test]
    fn home_prefers_home_env() {
        assert_eq!(
            super::home_from_env(
                Some("/home/user".to_string()),
                Some("/Users/user".to_string())
            ),
            "/home/user"
        );
    }

    async fn create_test_dir(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("webssh_rs_{name}_{nanos}"));
        fs::create_dir_all(&dir).await.unwrap();
        dir
    }

    #[cfg(windows)]
    fn set_windows_hidden_attribute(path: &std::path::Path) {
        let status = std::process::Command::new("attrib")
            .arg("+h")
            .arg(path)
            .status()
            .unwrap();

        assert!(status.success());
    }
}
