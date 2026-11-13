use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

use nanoid::nanoid;
use sea_orm::{ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, TransactionTrait};
use tokio::fs;

use crate::{
    apis::{
        ApiErr,
        sftp::{get_file_name, parse_file_uri},
    },
    consts::services_err_code::{
        ERR_CODE_DB_ERR, ERR_CODE_TRANSFER_INVALID_REQUEST, ERR_CODE_TRANSFER_NOT_FOUND,
    },
    entities::transfer_task::{
        self, ActiveModel, Entity as TaskEntity, Model as TaskModel, TransferConflictPolicy,
        TransferTaskKind, TransferTaskStatus, TransferTaskType,
    },
    map_db_err,
    sftp_client::SftpFileType,
    ssh_connection_pool::ChannelMode,
};

use super::{
    dto::{CreateDownloadBatchPayload, CreateUploadBatchPayload, TransferBatchResponse},
    ranges::{initial_ranges, ranges_to_json},
    service::{TransferService, map_transfer_io_err, now_ms},
};

impl TransferService {
    pub async fn create_upload_batch(
        &self,
        payload: CreateUploadBatchPayload,
    ) -> Result<TransferBatchResponse, ApiErr> {
        if payload.sources.is_empty() {
            return Err(invalid("sources must not be empty"));
        }
        let target = parse_file_uri(&payload.target_uri)?;
        let policy = payload
            .conflict_policy
            .unwrap_or(TransferConflictPolicy::Overwrite);
        let all = payload.all;
        let batch_id = nanoid!();
        tracing::info!(
            batch_id = %batch_id,
            target_id = target.target_id,
            source_count = payload.sources.len(),
            conflict_policy = ?policy,
            "upload batch discovery started"
        );
        let now = now_ms();
        let mut tasks = Vec::new();
        for source in payload.sources {
            let metadata = fs::symlink_metadata(&source)
                .await
                .map_err(map_transfer_io_err)?;
            let root = Path::new(&source)
                .file_name()
                .map(|v| v.to_string_lossy().to_string())
                .unwrap_or_else(|| "item".into());
            if metadata.is_dir() {
                tasks.push(self.directory_task_model(
                    &batch_id,
                    TransferTaskType::Upload,
                    PathBuf::from(&source),
                    format!(
                        "sftp:{}:{}",
                        target.target_id,
                        join_remote(target.path, &root)
                    ),
                    root,
                    now,
                    policy,
                    all,
                ));
            } else if metadata.is_file() {
                let requested_path = join_remote(target.path, &root);
                tasks.push(self.batch_file_model(
                    &batch_id,
                    TransferTaskType::Upload,
                    PathBuf::from(&source).to_string_lossy().to_string(),
                    format!("sftp:{}:{}", target.target_id, requested_path),
                    root,
                    metadata.len() as i64,
                    now,
                    TransferTaskStatus::Wait,
                    None,
                )?);
            } else {
                return Err(invalid("source must be a regular file or directory"));
            }
        }
        // SQLite uses one connection by default; finish SFTP discovery before opening the write transaction.
        let task_count = tasks.len();
        tracing::debug!(
            batch_id = %batch_id,
            task_count,
            "upload batch tasks discovered"
        );
        let txn = self.db.begin().await.map_err(db_err)?;
        TaskEntity::insert_many(tasks)
            .exec(&txn)
            .await
            .map_err(db_err)?;
        txn.commit().await.map_err(db_err)?;
        tracing::info!(
            batch_id = %batch_id,
            task_count,
            "upload batch persisted"
        );
        self.start_batch_tasks(&batch_id).await?;
        Ok(TransferBatchResponse { id: batch_id })
    }

    pub async fn create_download_batch(
        &self,
        payload: CreateDownloadBatchPayload,
    ) -> Result<TransferBatchResponse, ApiErr> {
        if payload.sources.is_empty() {
            return Err(invalid("sources must not be empty"));
        }
        let first_target_id = parse_file_uri(&payload.sources[0])?.target_id;
        let sources = payload.sources;
        let policy = payload
            .conflict_policy
            .unwrap_or(TransferConflictPolicy::Overwrite);
        let all = payload.all;
        let batch_id = nanoid!();
        tracing::info!(
            batch_id = %batch_id,
            target_id = first_target_id,
            source_count = sources.len(),
            conflict_policy = ?policy,
            "download batch discovery started"
        );
        let now = now_ms();
        let sftp = self
            .connection_pool
            .sftp(first_target_id, ChannelMode::Shared)
            .await
            .map_err(|e| ssh_err(e.to_string()))?;
        let mut tasks = Vec::new();
        for source in sources {
            let uri = parse_file_uri(&source)?;
            if uri.target_id != first_target_id {
                return Err(invalid("all sources must use the same target"));
            }
            let attr = sftp
                .metadata(uri.path)
                .await
                .map_err(|e| ssh_err(e.to_string()))?;
            let root = get_file_name(uri.path);
            if attr.file_type() == SftpFileType::Dir {
                tasks.push(self.directory_task_model(
                    &batch_id,
                    TransferTaskType::Download,
                    PathBuf::from(&payload.local_dir).join(&root),
                    format!("sftp:{}:{}", first_target_id, uri.path),
                    root,
                    now,
                    policy,
                    all,
                ));
            } else {
                let local = PathBuf::from(&payload.local_dir).join(&root);
                tasks.push(self.batch_file_model(
                    &batch_id,
                    TransferTaskType::Download,
                    local.to_string_lossy().to_string(),
                    format!("sftp:{}:{}", first_target_id, uri.path),
                    root,
                    attr.size.unwrap_or(0) as i64,
                    now,
                    TransferTaskStatus::Wait,
                    None,
                )?);
            }
        }
        drop(sftp);
        // SFTP target lookup also uses the SQLite connection, so keep it outside this transaction.
        let task_count = tasks.len();
        tracing::debug!(
            batch_id = %batch_id,
            task_count,
            "download batch tasks discovered"
        );
        let txn = self.db.begin().await.map_err(db_err)?;
        TaskEntity::insert_many(tasks)
            .exec(&txn)
            .await
            .map_err(db_err)?;
        txn.commit().await.map_err(db_err)?;
        tracing::info!(
            batch_id = %batch_id,
            task_count,
            "download batch persisted"
        );
        self.start_batch_tasks(&batch_id).await?;
        Ok(TransferBatchResponse { id: batch_id })
    }

    fn batch_file_model(
        &self,
        batch_id: &str,
        kind: TransferTaskType,
        local_path: String,
        target_uri: String,
        relative: String,
        total: i64,
        now: i64,
        status: TransferTaskStatus,
        fail_reason: Option<String>,
    ) -> Result<ActiveModel, ApiErr> {
        let target_id = parse_file_uri(target_uri.as_str())
            .ok()
            .map(|v| v.target_id);
        let terminal_success = status == TransferTaskStatus::Success;
        let ended = terminal_success || status == TransferTaskStatus::Fail;
        let task = ActiveModel {
            id: Set(nanoid!()),
            r#type: Set(kind),
            kind: Set(TransferTaskKind::File),
            status: Set(status),
            local_path: Set(Some(local_path)),
            target_uri: Set(Some(target_uri)),
            target_id: Set(target_id),
            name: Set(Path::new(&relative)
                .file_name()
                .map(|v| v.to_string_lossy().to_string())
                .unwrap_or(relative.clone())),
            loaded: Set(if terminal_success { total } else { 0 }),
            total: Set(total),
            percent: Set(if terminal_success || total == 0 {
                100.0
            } else {
                0.0
            }),
            speed: Set(0),
            estimated_time: Set(None),
            ranges: Set(ranges_to_json(&initial_ranges(total))?),
            fail_reason: Set(fail_reason),
            created_at: Set(now),
            updated_at: Set(now),
            ended_at: Set(ended.then_some(now)),
            batch_id: Set(Some(batch_id.to_string())),
            parent_id: Set(None),
            relative_path: Set(Some(relative)),
            conflict_policy: Set(None),
            all: Set(false),
        };
        Ok(task)
    }

    fn directory_task_model(
        &self,
        batch_id: &str,
        direction: TransferTaskType,
        local_path: PathBuf,
        target_uri: String,
        relative_path: String,
        now: i64,
        conflict_policy: TransferConflictPolicy,
        all: bool,
    ) -> ActiveModel {
        let target_id = parse_file_uri(&target_uri).ok().map(|uri| uri.target_id);
        let task = ActiveModel {
            id: Set(nanoid!()),
            r#type: Set(direction),
            kind: Set(TransferTaskKind::Directory),
            status: Set(TransferTaskStatus::Wait),
            local_path: Set(Some(local_path.to_string_lossy().to_string())),
            target_uri: Set(Some(target_uri)),
            target_id: Set(target_id),
            name: Set(Path::new(&relative_path)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or(relative_path.clone())),
            loaded: Set(0),
            total: Set(0),
            percent: Set(0.0),
            speed: Set(0),
            estimated_time: Set(None),
            ranges: Set("[]".to_string()),
            fail_reason: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
            ended_at: Set(None),
            batch_id: Set(Some(batch_id.to_string())),
            parent_id: Set(None),
            relative_path: Set(Some(relative_path)),
            conflict_policy: Set(Some(conflict_policy)),
            all: Set(all),
        };
        task
    }

    async fn start_batch_tasks(&self, id: &str) -> Result<(), ApiErr> {
        let tasks = TaskEntity::find()
            .filter(crate::entities::transfer_task::Column::BatchId.eq(id.to_string()))
            .all(&self.db)
            .await
            .map_err(|e| ApiErr {
                code: crate::consts::services_err_code::ERR_CODE_DB_ERR,
                message: e.to_string(),
            })?;
        let task_count = tasks.len();
        let mut queued_count = 0;
        for task in tasks {
            if task.status == TransferTaskStatus::Wait {
                self.queue_task(task.id).await?;
                queued_count += 1;
            }
        }
        tracing::info!(
            batch_id = %id,
            task_count,
            queued_count,
            "batch tasks queued"
        );
        Ok(())
    }

    pub async fn pause_batch(&self, id: &str) -> Result<TransferBatchResponse, ApiErr> {
        self.change_batch(id, TransferTaskStatus::Pause).await
    }
    pub async fn cancel_batch(&self, id: &str) -> Result<TransferBatchResponse, ApiErr> {
        self.change_batch(id, TransferTaskStatus::Cancel).await
    }
    pub async fn resume_batch(&self, id: &str) -> Result<TransferBatchResponse, ApiErr> {
        let tasks = self.batch_tasks(id).await?;
        for task in tasks {
            if matches!(
                task.status,
                TransferTaskStatus::Pause | TransferTaskStatus::Fail | TransferTaskStatus::Cancel
            ) {
                self.resume_task(&task.id).await?;
            }
        }
        Ok(TransferBatchResponse { id: id.to_string() })
    }
    async fn change_batch(
        &self,
        id: &str,
        status: TransferTaskStatus,
    ) -> Result<TransferBatchResponse, ApiErr> {
        let tasks = self.batch_tasks(id).await?;
        for task in tasks {
            if matches!(
                task.status,
                TransferTaskStatus::Wait | TransferTaskStatus::Run | TransferTaskStatus::Pause
            ) {
                match status {
                    TransferTaskStatus::Pause => {
                        self.pause_task(&task.id).await?;
                    }
                    TransferTaskStatus::Cancel => {
                        self.cancel_task(&task.id).await?;
                    }
                    _ => {}
                }
            }
        }
        Ok(TransferBatchResponse { id: id.to_string() })
    }
    async fn batch_tasks(&self, id: &str) -> Result<Vec<TaskModel>, ApiErr> {
        self.batch_tasks_only(id).await
    }
    async fn batch_tasks_only(&self, id: &str) -> Result<Vec<TaskModel>, ApiErr> {
        map_db_err!(
            TaskEntity::find()
                .filter(crate::entities::transfer_task::Column::BatchId.eq(id.to_string()))
                .all(&self.db)
                .await
        )
    }
    pub async fn delete_batch(&self, id: &str) -> Result<(), ApiErr> {
        let tasks = self.batch_tasks(id).await?;
        if tasks.is_empty() {
            return Err(invalid_not_found("transfer batch not found"));
        }
        for task in tasks {
            self.delete_task(&task.id).await?;
        }
        Ok(())
    }

    pub async fn pause_directory(&self, id: &str) -> Result<TransferBatchResponse, ApiErr> {
        self.change_directory(id, TransferTaskStatus::Pause).await
    }

    pub async fn cancel_directory(&self, id: &str) -> Result<TransferBatchResponse, ApiErr> {
        self.change_directory(id, TransferTaskStatus::Cancel).await
    }

    pub async fn resume_directory(&self, id: &str) -> Result<TransferBatchResponse, ApiErr> {
        let tasks = self.directory_tasks(id).await?;
        for task in tasks {
            if matches!(
                task.status,
                TransferTaskStatus::Pause | TransferTaskStatus::Fail | TransferTaskStatus::Cancel
            ) {
                self.resume_task(&task.id).await?;
            }
        }
        Ok(TransferBatchResponse { id: id.to_string() })
    }

    async fn change_directory(
        &self,
        id: &str,
        status: TransferTaskStatus,
    ) -> Result<TransferBatchResponse, ApiErr> {
        let tasks = self.directory_tasks(id).await?;
        for task in tasks {
            if matches!(
                task.status,
                TransferTaskStatus::Wait | TransferTaskStatus::Run | TransferTaskStatus::Pause
            ) {
                match status {
                    TransferTaskStatus::Pause => {
                        self.pause_task(&task.id).await?;
                    }
                    TransferTaskStatus::Cancel => {
                        self.cancel_task(&task.id).await?;
                    }
                    _ => {}
                }
            }
        }
        Ok(TransferBatchResponse { id: id.to_string() })
    }

    async fn directory_tasks(&self, id: &str) -> Result<Vec<TaskModel>, ApiErr> {
        let root = self.get_task_model(id).await?;
        if root.kind != TransferTaskKind::Directory {
            return Err(invalid("transfer task is not a directory"));
        }
        let batch_id = root
            .batch_id
            .as_deref()
            .ok_or_else(|| invalid("directory task requires batch_id"))?;
        let tasks = self.batch_tasks_only(batch_id).await?;
        let mut ids = HashSet::from([id.to_string()]);
        let mut changed = true;
        while changed {
            changed = false;
            for task in &tasks {
                if task
                    .parent_id
                    .as_deref()
                    .is_some_and(|parent| ids.contains(parent))
                    && ids.insert(task.id.clone())
                {
                    changed = true;
                }
            }
        }
        Ok(tasks
            .into_iter()
            .filter(|task| ids.contains(&task.id))
            .collect())
    }

    pub async fn delete_directory(&self, id: &str) -> Result<(), ApiErr> {
        let tasks = self.directory_tasks(id).await?;
        for task in tasks {
            self.delete_task(&task.id).await?;
        }
        Ok(())
    }

    pub async fn delete_finished_history(&self) -> Result<(), ApiErr> {
        let txn = map_db_err!(self.db.begin().await)?;

        map_db_err!(
            TaskEntity::delete_many()
                .filter(transfer_task::Column::Status.is_in([
                    TransferTaskStatus::Success,
                    TransferTaskStatus::Fail,
                    TransferTaskStatus::Cancel,
                ]))
                .exec(&txn)
                .await
        )?;
        map_db_err!(txn.commit().await)?;
        Ok(())
    }
}

fn join_remote(base: &str, relative: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        relative.trim_start_matches('/')
    )
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
fn invalid_not_found(message: &str) -> ApiErr {
    ApiErr {
        code: ERR_CODE_TRANSFER_NOT_FOUND,
        message: message.into(),
    }
}
fn ssh_err(message: String) -> ApiErr {
    ApiErr {
        code: crate::consts::services_err_code::ERR_CODE_SSH_ERR,
        message,
    }
}
