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

pub async fn list(path: &str) -> Result<Vec<FsFile>, ApiErr> {
    if should_list_roots(path) {
        return list_roots().await;
    }

    list_dir(path).await
}

async fn list_dir(path: &str) -> Result<Vec<FsFile>, ApiErr> {
    let mut entries = fs::read_dir(path).await.map_err(map_fs_io_err)?;
    let mut files = Vec::new();

    while let Some(entry) = entries.next_entry().await.map_err(map_fs_io_err)? {
        let path = entry.path();
        let metadata = entry.metadata().await.map_err(map_fs_io_err)?;
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
    let metadata = fs::metadata(&payload.path).await.map_err(map_fs_io_err)?;
    if metadata.is_dir() {
        return Err(ApiErr {
            code: ERR_CODE_FS_INVALID_REQUEST,
            message: "copy directory is not supported".to_string(),
        });
    }
    fs::copy(&payload.path, &payload.target_path)
        .await
        .map_err(map_fs_io_err)?;
    Ok(())
}

pub async fn rename(payload: FsRenamePayload) -> Result<(), ApiErr> {
    fs::rename(&payload.path, &payload.target_path)
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
                path,
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
        path: path.to_string_lossy().to_string(),
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
            .map(|duration| duration.as_secs()),
        mtime: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs()),
        permissions: permissions_to_string(&metadata),
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
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
    use super::list;

    #[cfg(unix)]
    #[tokio::test]
    async fn list_root_returns_root_directory_entries() {
        let files = list("/").await.unwrap();

        assert!(files.iter().all(|file| file.path != "/"));
        assert!(files.iter().any(|file| file.path == "/tmp"));
    }
}
