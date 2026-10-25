use std::path::{Path, PathBuf};

use nanoid::nanoid;
use sea_orm::sea_query::OnConflict;
use sea_orm::{ActiveModelTrait, ActiveValue::Set, EntityTrait, TransactionTrait};
use tokio::fs;

use crate::{
    apis::{ApiErr, sftp::parse_file_uri},
    consts::services_err_code::{
        ERR_CODE_DB_ERR, ERR_CODE_SSH_ERR, ERR_CODE_TRANSFER_INVALID_REQUEST,
    },
    entities::{
        transfer_batch::TransferConflictPolicy,
        transfer_task::{
            ActiveModel, Column, Entity, Model, TransferTaskKind, TransferTaskStatus,
            TransferTaskType,
        },
    },
    sftp_client::{FastSftpClient, SftpError, SftpFileType},
    ssh_connection_pool::ChannelMode,
};

use super::{
    ranges::{initial_ranges, ranges_to_json},
    service::{TransferService, map_transfer_io_err, now_ms},
};

impl TransferService {
    pub(super) async fn run_directory(&self, id: &str) -> Result<(), ApiErr> {
        let task = self.get_task_model(id).await?;
        let local_path = task
            .local_path
            .as_deref()
            .ok_or_else(|| invalid("missing local_path"))?;
        let target_uri = task
            .target_uri
            .as_deref()
            .ok_or_else(|| invalid("missing target_uri"))?;
        let batch_id = task
            .batch_id
            .as_deref()
            .ok_or_else(|| invalid("directory task requires batch_id"))?;
        let policy = task
            .conflict_policy
            .unwrap_or(TransferConflictPolicy::Overwrite);
        let relative_path = task.relative_path.as_deref().unwrap_or_else(|| &task.name);
        let target = parse_file_uri(target_uri)?;

        match task.r#type {
            TransferTaskType::Upload => {
                let sftp = self
                    .connection_pool
                    .sftp(target.target_id, ChannelMode::Shared)
                    .await
                    .map_err(|err| ssh_err(err.to_string()))?;
                let Some(target_path) =
                    resolve_remote_directory(&sftp, target.path.to_string(), &policy).await?
                else {
                    return self.commit_directory_children(&task, Vec::new()).await;
                };
                if !remote_exists(&sftp, &target_path).await? {
                    sftp.create_dir(&target_path)
                        .await
                        .map_err(|err| ssh_err(err.to_string()))?;
                }
                let children = read_local_children(&local_path).await?;
                drop(sftp);
                let mut models = Vec::with_capacity(children.len());
                for child in children {
                    if !is_safe_component(&child.name) {
                        continue;
                    }
                    let child_relative = join_relative(&relative_path, &child.name);
                    let child_target = join_remote(&target_path, &child.name);
                    match child.kind {
                        ChildKind::Directory => models.push(directory_model(
                            batch_id,
                            TransferTaskType::Upload,
                            child.path.into(),
                            format!("sftp:{}:{}", target.target_id, child_target),
                            child_relative,
                            policy,
                        )),
                        ChildKind::File(total) => {
                            let sftp = self
                                .connection_pool
                                .sftp(target.target_id, ChannelMode::Shared)
                                .await
                                .map_err(|err| ssh_err(err.to_string()))?;
                            let (path, status, reason) =
                                resolve_remote_conflict(&sftp, child_target, &policy).await?;
                            models.push(file_model(
                                batch_id,
                                TransferTaskType::Upload,
                                child.path,
                                format!("sftp:{}:{}", target.target_id, path),
                                child_relative,
                                total,
                                status,
                                reason,
                            ));
                        }
                    }
                }
                self.commit_directory_children(&task, models).await
            }
            TransferTaskType::Download => {
                let sftp = self
                    .connection_pool
                    .sftp(target.target_id, ChannelMode::Shared)
                    .await
                    .map_err(|err| ssh_err(err.to_string()))?;
                let local_root = PathBuf::from(&local_path);
                let Some(local_root) = resolve_local_directory(local_root, &policy).await? else {
                    return self.commit_directory_children(&task, Vec::new()).await;
                };
                let entries = sftp
                    .read_dir(target.path)
                    .await
                    .map_err(|err| ssh_err(err.to_string()))?;
                let mut models = Vec::with_capacity(entries.len());
                for entry in entries {
                    let (name, attrs) = entry.into_parts();
                    if !is_safe_component(&name) {
                        continue;
                    }
                    let child_relative = join_relative(&relative_path, &name);
                    let child_remote = join_remote(target.path, &name);
                    match attrs.file_type() {
                        SftpFileType::Dir => models.push(directory_model(
                            batch_id,
                            TransferTaskType::Download,
                            local_root.join(&name),
                            format!("sftp:{}:{}", target.target_id, child_remote),
                            child_relative,
                            policy,
                        )),
                        SftpFileType::File => {
                            let local = local_root.join(&name);
                            let (local, status, reason) =
                                resolve_local_conflict(local, &policy).await?;
                            models.push(file_model(
                                batch_id,
                                TransferTaskType::Download,
                                local,
                                format!("sftp:{}:{}", target.target_id, child_remote),
                                child_relative,
                                attrs.size.unwrap_or(0) as i64,
                                status,
                                reason,
                            ));
                        }
                        _ => {}
                    }
                }
                drop(sftp);
                fs::create_dir_all(&local_root)
                    .await
                    .map_err(map_transfer_io_err)?;
                self.commit_directory_children(&task, models).await
            }
        }
    }

    async fn commit_directory_children(
        &self,
        parent: &Model,
        children: Vec<ActiveModel>,
    ) -> Result<(), ApiErr> {
        let txn = self.db.begin().await.map_err(db_err)?;
        for child in children {
            Entity::insert(child)
                .on_conflict(
                    OnConflict::columns([Column::BatchId, Column::RelativePath, Column::Kind])
                        .do_nothing()
                        .to_owned(),
                )
                .exec(&txn)
                .await
                .map_err(db_err)?;
        }
        let mut parent_active: ActiveModel = parent.clone().into();
        parent_active.status = Set(TransferTaskStatus::Success);
        parent_active.percent = Set(100.0);
        parent_active.updated_at = Set(now_ms());
        parent_active.ended_at = Set(Some(now_ms()));
        parent_active.ranges = Set("[]".to_string());
        parent_active.update(&txn).await.map_err(db_err)?;
        txn.commit().await.map_err(db_err)?;
        self.scheduler_notify.notify_one();
        Ok(())
    }
}

#[derive(Clone)]
enum ChildKind {
    Directory,
    File(i64),
}

struct Child {
    name: String,
    path: String,
    kind: ChildKind,
}

async fn read_local_children(path: &str) -> Result<Vec<Child>, ApiErr> {
    let mut entries = fs::read_dir(path).await.map_err(map_transfer_io_err)?;
    let mut children = Vec::new();
    while let Some(entry) = entries.next_entry().await.map_err(map_transfer_io_err)? {
        let child_path = entry.path();
        let metadata = fs::symlink_metadata(&child_path)
            .await
            .map_err(map_transfer_io_err)?;
        let kind = if metadata.is_dir() {
            ChildKind::Directory
        } else if metadata.is_file() {
            ChildKind::File(metadata.len() as i64)
        } else {
            continue;
        };
        children.push(Child {
            name: entry.file_name().to_string_lossy().to_string(),
            path: child_path.to_string_lossy().to_string(),
            kind,
        });
    }
    Ok(children)
}

fn directory_model(
    batch_id: &str,
    direction: TransferTaskType,
    local: PathBuf,
    target: String,
    relative: String,
    conflict_policy: TransferConflictPolicy,
) -> ActiveModel {
    task_model(
        batch_id,
        direction,
        TransferTaskKind::Directory,
        local.to_string_lossy().to_string(),
        target,
        relative,
        0,
        TransferTaskStatus::Wait,
        None,
        Some(conflict_policy),
    )
}

fn file_model(
    batch_id: &str,
    direction: TransferTaskType,
    local: String,
    target: String,
    relative: String,
    total: i64,
    status: TransferTaskStatus,
    reason: Option<String>,
) -> ActiveModel {
    task_model(
        batch_id,
        direction,
        TransferTaskKind::File,
        local,
        target,
        relative,
        total,
        status,
        reason,
        None,
    )
}

fn task_model(
    batch_id: &str,
    direction: TransferTaskType,
    kind: TransferTaskKind,
    local: String,
    target: String,
    relative: String,
    total: i64,
    status: TransferTaskStatus,
    reason: Option<String>,
    conflict_policy: Option<TransferConflictPolicy>,
) -> ActiveModel {
    let now = now_ms();
    let terminal_success = status == TransferTaskStatus::Success;
    let file_kind = kind == TransferTaskKind::File;
    let ended = terminal_success || status == TransferTaskStatus::Fail;
    ActiveModel {
        id: Set(nanoid!()),
        r#type: Set(direction),
        kind: Set(kind),
        status: Set(status),
        local_path: Set(Some(local)),
        target_id: Set(parse_file_uri(&target).ok().map(|uri| uri.target_id)),
        target_uri: Set(Some(target)),
        name: Set(Path::new(&relative)
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or(relative.clone())),
        loaded: Set(if terminal_success { total } else { 0 }),
        total: Set(total),
        percent: Set(if terminal_success || total == 0 && file_kind {
            100.0
        } else {
            0.0
        }),
        speed: Set(0),
        estimated_time: Set(None),
        ranges: Set(ranges_to_json(&initial_ranges(total)).unwrap_or_else(|_| "[]".to_string())),
        fail_reason: Set(reason),
        created_at: Set(now),
        updated_at: Set(now),
        ended_at: Set(ended.then_some(now)),
        batch_id: Set(Some(batch_id.to_string())),
        relative_path: Set(Some(relative)),
        conflict_policy: Set(conflict_policy),
    }
}

async fn resolve_remote_conflict(
    sftp: &FastSftpClient,
    requested: String,
    policy: &TransferConflictPolicy,
) -> Result<(String, TransferTaskStatus, Option<String>), ApiErr> {
    if !remote_exists(sftp, &requested).await? {
        return Ok((requested, TransferTaskStatus::Wait, None));
    }
    match policy {
        TransferConflictPolicy::Overwrite => Ok((requested, TransferTaskStatus::Wait, None)),
        TransferConflictPolicy::Skip => Ok((requested, TransferTaskStatus::Success, None)),
        TransferConflictPolicy::Fail => Ok((
            requested,
            TransferTaskStatus::Fail,
            Some("target already exists".into()),
        )),
        TransferConflictPolicy::Rename => {
            let mut index = 1;
            loop {
                let candidate = renamed_path(&requested, index);
                if !remote_exists(sftp, &candidate).await? {
                    return Ok((candidate, TransferTaskStatus::Wait, None));
                }
                index += 1;
            }
        }
    }
}

async fn resolve_remote_directory(
    sftp: &FastSftpClient,
    requested: String,
    policy: &TransferConflictPolicy,
) -> Result<Option<String>, ApiErr> {
    if !remote_exists(sftp, &requested).await? {
        return Ok(Some(requested));
    }
    match policy {
        TransferConflictPolicy::Overwrite => Ok(Some(requested)),
        TransferConflictPolicy::Skip => Ok(None),
        TransferConflictPolicy::Fail => Err(invalid("target directory already exists")),
        TransferConflictPolicy::Rename => {
            let mut index = 1;
            loop {
                let candidate = renamed_path(&requested, index);
                if !remote_exists(sftp, &candidate).await? {
                    return Ok(Some(candidate));
                }
                index += 1;
            }
        }
    }
}

async fn resolve_local_conflict(
    path: PathBuf,
    policy: &TransferConflictPolicy,
) -> Result<(String, TransferTaskStatus, Option<String>), ApiErr> {
    if !fs::try_exists(&path).await.map_err(map_transfer_io_err)? {
        return Ok((
            path.to_string_lossy().to_string(),
            TransferTaskStatus::Wait,
            None,
        ));
    }
    match policy {
        TransferConflictPolicy::Overwrite => Ok((
            path.to_string_lossy().to_string(),
            TransferTaskStatus::Wait,
            None,
        )),
        TransferConflictPolicy::Skip => Ok((
            path.to_string_lossy().to_string(),
            TransferTaskStatus::Success,
            None,
        )),
        TransferConflictPolicy::Fail => Ok((
            path.to_string_lossy().to_string(),
            TransferTaskStatus::Fail,
            Some("target already exists".into()),
        )),
        TransferConflictPolicy::Rename => {
            let mut index = 1;
            loop {
                let candidate = renamed_path_buf(&path, index);
                if !fs::try_exists(&candidate)
                    .await
                    .map_err(map_transfer_io_err)?
                {
                    return Ok((
                        candidate.to_string_lossy().to_string(),
                        TransferTaskStatus::Wait,
                        None,
                    ));
                }
                index += 1;
            }
        }
    }
}

async fn resolve_local_directory(
    path: PathBuf,
    policy: &TransferConflictPolicy,
) -> Result<Option<PathBuf>, ApiErr> {
    if !fs::try_exists(&path).await.map_err(map_transfer_io_err)? {
        return Ok(Some(path));
    }
    match policy {
        TransferConflictPolicy::Overwrite => Ok(Some(path)),
        TransferConflictPolicy::Skip => Ok(None),
        TransferConflictPolicy::Fail => Err(invalid("target directory already exists")),
        TransferConflictPolicy::Rename => {
            let mut index = 1;
            loop {
                let candidate = renamed_path_buf(&path, index);
                if !fs::try_exists(&candidate)
                    .await
                    .map_err(map_transfer_io_err)?
                {
                    return Ok(Some(candidate));
                }
                index += 1;
            }
        }
    }
}

async fn remote_exists(sftp: &FastSftpClient, path: &str) -> Result<bool, ApiErr> {
    match sftp.metadata(path).await {
        Ok(_) => Ok(true),
        Err(SftpError::Status { code: 2, .. }) => Ok(false),
        Err(err) => Err(ssh_err(err.to_string())),
    }
}

fn join_relative(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}
fn is_safe_component(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains('/') && !name.contains('\\')
}
fn join_remote(parent: &str, name: &str) -> String {
    format!(
        "{}/{}",
        parent.trim_end_matches('/'),
        name.trim_start_matches('/')
    )
}
fn renamed_path(path: &str, index: usize) -> String {
    let (parent, name) = path.rsplit_once('/').unwrap_or(("", path));
    let (stem, ext) = name
        .rsplit_once('.')
        .filter(|(stem, _)| !stem.is_empty())
        .map(|(s, e)| (s.to_string(), format!(".{e}")))
        .unwrap_or_else(|| (name.to_string(), String::new()));
    let name = format!("{stem} ({index}){ext}");
    if parent.is_empty() {
        name
    } else {
        format!("{parent}/{name}")
    }
}
fn renamed_path_buf(path: &Path, index: usize) -> PathBuf {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    let (stem, ext) = name
        .rsplit_once('.')
        .filter(|(stem, _)| !stem.is_empty())
        .map(|(s, e)| (s.to_string(), format!(".{e}")))
        .unwrap_or((name, String::new()));
    path.with_file_name(format!("{stem} ({index}){ext}"))
}
fn invalid(message: &str) -> ApiErr {
    ApiErr {
        code: ERR_CODE_TRANSFER_INVALID_REQUEST,
        message: message.into(),
    }
}
fn db_err(error: sea_orm::DbErr) -> ApiErr {
    ApiErr {
        code: ERR_CODE_DB_ERR,
        message: error.to_string(),
    }
}
fn ssh_err(message: String) -> ApiErr {
    ApiErr {
        code: ERR_CODE_SSH_ERR,
        message,
    }
}
