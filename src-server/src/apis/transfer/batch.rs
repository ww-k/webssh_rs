use std::path::{Path, PathBuf};

use nanoid::nanoid;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, TransactionTrait,
};
use tokio::fs;

use crate::{
    apis::{
        ApiErr,
        sftp::{get_file_name, parse_file_uri},
    },
    consts::services_err_code::{
        ERR_CODE_DB_ERR, ERR_CODE_TRANSFER_INVALID_REQUEST, ERR_CODE_TRANSFER_NOT_FOUND,
    },
    entities::{
        transfer_batch::{
            self, ActiveModel as BatchActiveModel, Entity as BatchEntity, Model as BatchModel,
            TransferBatchStatus, TransferBatchType, TransferConflictPolicy,
        },
        transfer_task::{
            self, ActiveModel, Entity as TaskEntity, Model as TaskModel, TransferTaskKind,
            TransferTaskStatus, TransferTaskType,
        },
    },
    map_db_err,
    sftp_client::SftpFileType,
    ssh_connection_pool::ChannelMode,
};

use super::{
    dto::{
        BatchItemsResponse, CreateDownloadBatchPayload, CreateUploadBatchPayload,
        TransferBatchResponse, TransferTaskResponse,
    },
    ranges::{initial_ranges, ranges_to_json},
    service::{TransferService, map_transfer_io_err, now_ms},
};

impl TransferService {
    pub async fn create_upload_batch(
        &self,
        payload: CreateUploadBatchPayload,
    ) -> Result<BatchModel, ApiErr> {
        if payload.sources.is_empty() {
            return Err(invalid("sources must not be empty"));
        }
        let target = parse_file_uri(&payload.target_uri)?;
        let policy = payload
            .conflict_policy
            .unwrap_or(TransferConflictPolicy::Overwrite);
        let batch_id = nanoid!();
        tracing::info!(
            batch_id = %batch_id,
            target_id = target.target_id,
            source_count = payload.sources.len(),
            conflict_policy = ?policy,
            "upload batch discovery started"
        );
        let now = now_ms();
        let name = if payload.sources.len() == 1 {
            Path::new(&payload.sources[0])
                .file_name()
                .map(|v| v.to_string_lossy().to_string())
                .unwrap_or_else(|| "Upload".into())
        } else {
            format!("{} items", payload.sources.len())
        };
        let batch = BatchActiveModel {
            id: Set(batch_id.clone()),
            r#type: Set(TransferBatchType::Upload),
            status: Set(TransferBatchStatus::Wait),
            name: Set(name),
            target_id: Set(Some(target.target_id)),
            conflict_policy: Set(policy),
            item_count: Set(0),
            completed_count: Set(0),
            failed_count: Set(0),
            directory_count: Set(0),
            directory_failed_count: Set(0),
            total: Set(0),
            loaded: Set(0),
            percent: Set(None),
            speed: Set(0),
            estimated_time: Set(None),
            fail_reason: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
            ended_at: Set(None),
        };
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
        batch.insert(&txn).await.map_err(db_err)?;
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
        self.get_batch_model(&batch_id).await
    }

    pub async fn create_download_batch(
        &self,
        payload: CreateDownloadBatchPayload,
    ) -> Result<BatchModel, ApiErr> {
        if payload.sources.is_empty() {
            return Err(invalid("sources must not be empty"));
        }
        let first_target_id = parse_file_uri(&payload.sources[0])?.target_id;
        let sources = payload.sources;
        let policy = payload
            .conflict_policy
            .unwrap_or(TransferConflictPolicy::Overwrite);
        let batch_id = nanoid!();
        tracing::info!(
            batch_id = %batch_id,
            target_id = first_target_id,
            source_count = sources.len(),
            conflict_policy = ?policy,
            "download batch discovery started"
        );
        let now = now_ms();
        let batch = BatchActiveModel {
            id: Set(batch_id.clone()),
            r#type: Set(TransferBatchType::Download),
            status: Set(TransferBatchStatus::Wait),
            name: Set(format!("{} items", sources.len())),
            target_id: Set(Some(first_target_id)),
            conflict_policy: Set(policy),
            item_count: Set(0),
            completed_count: Set(0),
            failed_count: Set(0),
            directory_count: Set(0),
            directory_failed_count: Set(0),
            total: Set(0),
            loaded: Set(0),
            percent: Set(None),
            speed: Set(0),
            estimated_time: Set(None),
            fail_reason: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
            ended_at: Set(None),
        };
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
        batch.insert(&txn).await.map_err(db_err)?;
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
        self.get_batch_model(&batch_id).await
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
            relative_path: Set(Some(relative)),
            conflict_policy: Set(None),
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
            relative_path: Set(Some(relative_path)),
            conflict_policy: Set(Some(conflict_policy)),
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
        self.batch_refresh_notify.notify_one();
        Ok(())
    }

    pub async fn get_batch_model(&self, id: &str) -> Result<BatchModel, ApiErr> {
        let model = map_db_err!(BatchEntity::find_by_id(id.to_string()).one(&self.db).await)?;
        if let Some(model) = model {
            return Ok(model);
        }

        let tasks = self.batch_tasks_only(id).await?;
        synthetic_batch(id, &tasks)
    }

    pub async fn list_batches(&self) -> Result<Vec<BatchModel>, ApiErr> {
        let models = map_db_err!(
            BatchEntity::find()
                .order_by_desc(transfer_batch::Column::CreatedAt)
                .all(&self.db)
                .await
        )?;
        Ok(models)
    }

    pub async fn get_batch_items(
        &self,
        id: &str,
        cursor: Option<String>,
        limit: u64,
    ) -> Result<BatchItemsResponse, ApiErr> {
        let mut query = TaskEntity::find()
            .filter(crate::entities::transfer_task::Column::BatchId.eq(id.to_string()))
            .order_by_asc(crate::entities::transfer_task::Column::CreatedAt)
            .limit(limit.min(200));
        if let Some(cursor) = cursor {
            query = query.filter(crate::entities::transfer_task::Column::Id.gt(cursor));
        }
        let tasks = map_db_err!(query.all(&self.db).await)?;
        let next_cursor = tasks.last().map(|t| t.id.clone());
        let items = tasks
            .into_iter()
            .map(task_response)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(BatchItemsResponse { items, next_cursor })
    }

    async fn refresh_batch_model(&self, model: BatchModel) -> Result<(), ApiErr> {
        let id = model.id.as_str();
        let tasks = self.batch_tasks_only(id).await?;
        let summary = summarize_tasks(&tasks);
        let ended_at = if summary.terminal {
            model.ended_at.or_else(|| Some(now_ms()))
        } else {
            None
        };
        tracing::debug!(
            batch_id = %id,
            status = ?summary.status,
            item_count = summary.item_count,
            completed_count = summary.completed_count,
            failed_count = summary.failed_count,
            directory_count = summary.directory_count,
            "batch summary refreshed"
        );
        let changed = model.status != summary.status
            || model.item_count != summary.item_count
            || model.completed_count != summary.completed_count
            || model.failed_count != summary.failed_count
            || model.directory_count != summary.directory_count
            || model.directory_failed_count != summary.directory_failed_count
            || model.total != summary.total
            || model.loaded != summary.loaded
            || model.percent != summary.percent
            || model.speed != summary.speed
            || model.estimated_time != summary.estimated_time
            || model.fail_reason != summary.fail_reason
            || model.ended_at != ended_at;
        if !changed {
            return Ok(());
        }
        let mut active: BatchActiveModel = model.into();
        active.status = Set(summary.status);
        active.item_count = Set(summary.item_count);
        active.completed_count = Set(summary.completed_count);
        active.failed_count = Set(summary.failed_count);
        active.directory_count = Set(summary.directory_count);
        active.directory_failed_count = Set(summary.directory_failed_count);
        active.total = Set(summary.total);
        active.loaded = Set(summary.loaded);
        active.percent = Set(summary.percent);
        active.speed = Set(summary.speed);
        active.estimated_time = Set(summary.estimated_time);
        active.fail_reason = Set(summary.fail_reason);
        active.updated_at = Set(now_ms());
        active.ended_at = Set(ended_at);
        map_db_err!(active.update(&self.db).await)?;
        Ok(())
    }

    pub(super) async fn refresh_active_batches(&self) -> bool {
        let batches = match BatchEntity::find()
            .filter(transfer_batch::Column::Status.is_in([
                TransferBatchStatus::Wait,
                TransferBatchStatus::Run,
                TransferBatchStatus::Pause,
            ]))
            .all(&self.db)
            .await
        {
            Ok(batches) => batches,
            Err(err) => {
                tracing::warn!(error = %err, "periodic batch query failed");
                return true;
            }
        };
        let has_active_batches = !batches.is_empty();

        for batch in batches {
            let batch_id = batch.id.clone();
            if let Err(err) = self.refresh_batch_model(batch).await {
                tracing::warn!(
                    batch_id = %batch_id,
                    error = %err.message,
                    "periodic batch refresh failed"
                );
            }
        }
        has_active_batches
    }

    pub async fn pause_batch(&self, id: &str) -> Result<BatchModel, ApiErr> {
        self.change_batch(id, TransferBatchStatus::Pause).await
    }
    pub async fn cancel_batch(&self, id: &str) -> Result<BatchModel, ApiErr> {
        self.change_batch(id, TransferBatchStatus::Cancel).await
    }
    pub async fn resume_batch(&self, id: &str) -> Result<BatchModel, ApiErr> {
        let tasks = self.batch_tasks(id).await?;
        for task in tasks {
            if matches!(
                task.status,
                TransferTaskStatus::Pause | TransferTaskStatus::Fail | TransferTaskStatus::Cancel
            ) {
                self.resume_task(&task.id).await?;
            }
        }
        self.get_batch_model(id).await
    }
    async fn change_batch(
        &self,
        id: &str,
        status: TransferBatchStatus,
    ) -> Result<BatchModel, ApiErr> {
        let tasks = self.batch_tasks(id).await?;
        for task in tasks {
            if matches!(
                task.status,
                TransferTaskStatus::Wait | TransferTaskStatus::Run | TransferTaskStatus::Pause
            ) {
                match status {
                    TransferBatchStatus::Pause => {
                        self.pause_task(&task.id).await?;
                    }
                    TransferBatchStatus::Cancel => {
                        self.cancel_task(&task.id).await?;
                    }
                    _ => {}
                }
            }
        }
        self.get_batch_model(id).await
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
        self.get_batch_model(id).await?;
        map_db_err!(
            BatchEntity::delete_by_id(id.to_string())
                .exec(&self.db)
                .await
        )?;
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
        map_db_err!(
            BatchEntity::delete_many()
                .filter(transfer_batch::Column::Status.is_in([
                    TransferBatchStatus::Success,
                    TransferBatchStatus::Fail,
                    TransferBatchStatus::Cancel,
                ]))
                .exec(&txn)
                .await
        )?;

        map_db_err!(txn.commit().await)?;
        Ok(())
    }
}

struct BatchSummary {
    status: TransferBatchStatus,
    item_count: i64,
    completed_count: i64,
    failed_count: i64,
    directory_count: i64,
    directory_failed_count: i64,
    total: i64,
    loaded: i64,
    percent: Option<f64>,
    speed: i64,
    estimated_time: Option<i64>,
    fail_reason: Option<String>,
    terminal: bool,
}

fn summarize_tasks(tasks: &[TaskModel]) -> BatchSummary {
    let item_count = tasks
        .iter()
        .filter(|task| task.kind == TransferTaskKind::File)
        .count() as i64;
    let completed_count = tasks
        .iter()
        .filter(|task| {
            task.kind == TransferTaskKind::File && task.status == TransferTaskStatus::Success
        })
        .count() as i64;
    let failed_count = tasks
        .iter()
        .filter(|task| {
            task.kind == TransferTaskKind::File && task.status == TransferTaskStatus::Fail
        })
        .count() as i64;
    let directory_count = tasks
        .iter()
        .filter(|task| task.kind == TransferTaskKind::Directory)
        .count() as i64;
    let directory_failed_count = tasks
        .iter()
        .filter(|task| {
            task.kind == TransferTaskKind::Directory && task.status == TransferTaskStatus::Fail
        })
        .count() as i64;
    let total = tasks
        .iter()
        .filter(|task| task.kind == TransferTaskKind::File)
        .map(|task| task.total)
        .sum();
    let loaded = tasks
        .iter()
        .filter(|task| task.kind == TransferTaskKind::File)
        .map(|task| task.loaded)
        .sum();
    let status = if tasks
        .iter()
        .any(|task| task.status == TransferTaskStatus::Run)
    {
        TransferBatchStatus::Run
    } else if tasks
        .iter()
        .any(|task| task.status == TransferTaskStatus::Wait)
    {
        TransferBatchStatus::Wait
    } else if tasks
        .iter()
        .any(|task| task.status == TransferTaskStatus::Pause)
    {
        TransferBatchStatus::Pause
    } else if tasks
        .iter()
        .any(|task| task.status == TransferTaskStatus::Fail)
    {
        TransferBatchStatus::Fail
    } else if tasks
        .iter()
        .any(|task| task.status == TransferTaskStatus::Cancel)
    {
        TransferBatchStatus::Cancel
    } else if !tasks.is_empty()
        && tasks
            .iter()
            .all(|task| task.status == TransferTaskStatus::Success)
    {
        TransferBatchStatus::Success
    } else {
        TransferBatchStatus::Wait
    };
    let discovery_active = tasks.iter().any(|task| {
        task.kind == TransferTaskKind::Directory
            && matches!(
                task.status,
                TransferTaskStatus::Wait | TransferTaskStatus::Run | TransferTaskStatus::Pause
            )
    });
    let percent = if discovery_active {
        None
    } else if matches!(
        status,
        TransferBatchStatus::Success | TransferBatchStatus::Cancel
    ) {
        Some(100.0)
    } else if total == 0 {
        Some(0.0)
    } else {
        Some(loaded as f64 * 100.0 / total as f64)
    };
    let speed = tasks
        .iter()
        .filter(|task| task.kind == TransferTaskKind::File)
        .map(|task| task.speed)
        .sum();
    let terminal = matches!(
        status,
        TransferBatchStatus::Success | TransferBatchStatus::Fail | TransferBatchStatus::Cancel
    );
    let estimated_time = if discovery_active {
        None
    } else if total > loaded && speed > 0 {
        Some((total - loaded) / speed)
    } else if terminal {
        Some(0)
    } else {
        None
    };
    BatchSummary {
        status,
        item_count,
        completed_count,
        failed_count,
        directory_count,
        directory_failed_count,
        total,
        loaded,
        percent,
        speed,
        estimated_time,
        fail_reason: tasks.iter().find_map(|task| task.fail_reason.clone()),
        terminal,
    }
}

fn synthetic_batch(id: &str, tasks: &[TaskModel]) -> Result<BatchModel, ApiErr> {
    let first = tasks
        .first()
        .ok_or_else(|| invalid_not_found("transfer batch not found"))?;
    let summary = summarize_tasks(tasks);
    Ok(BatchModel {
        id: id.to_string(),
        r#type: match first.r#type {
            TransferTaskType::Upload => TransferBatchType::Upload,
            TransferTaskType::Download => TransferBatchType::Download,
        },
        status: summary.status,
        name: first.batch_id.clone().unwrap_or_else(|| first.name.clone()),
        target_id: first.target_id,
        conflict_policy: TransferConflictPolicy::Overwrite,
        item_count: summary.item_count,
        completed_count: summary.completed_count,
        failed_count: summary.failed_count,
        directory_count: summary.directory_count,
        directory_failed_count: summary.directory_failed_count,
        total: summary.total,
        loaded: summary.loaded,
        percent: summary.percent,
        speed: summary.speed,
        estimated_time: summary.estimated_time,
        fail_reason: summary.fail_reason,
        created_at: tasks
            .iter()
            .map(|task| task.created_at)
            .min()
            .unwrap_or_default(),
        updated_at: tasks
            .iter()
            .map(|task| task.updated_at)
            .max()
            .unwrap_or_default(),
        ended_at: summary.terminal.then(|| {
            tasks
                .iter()
                .filter_map(|task| task.ended_at)
                .max()
                .unwrap_or_default()
        }),
    })
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
fn task_response(task: TaskModel) -> Result<TransferTaskResponse, ApiErr> {
    Ok(TransferTaskResponse {
        id: task.id,
        r#type: task.r#type,
        kind: task.kind,
        status: task.status,
        local_path: task.local_path,
        target_uri: task.target_uri,
        target_id: task.target_id,
        name: task.name,
        loaded: task.loaded,
        total: task.total,
        percent: task.percent,
        speed: task.speed,
        estimated_time: task.estimated_time,
        ranges: super::ranges::ranges_from_json(&task.ranges)?
            .into_iter()
            .map(|[s, e]| super::dto::TransferRangeSchema(s, e))
            .collect(),
        fail_reason: task.fail_reason,
        created_at: task.created_at,
        updated_at: task.updated_at,
        ended_at: task.ended_at,
        batch_id: task.batch_id,
        relative_path: task.relative_path,
        conflict_policy: task.conflict_policy,
    })
}

impl From<BatchModel> for TransferBatchResponse {
    fn from(value: BatchModel) -> Self {
        Self {
            id: value.id,
            r#type: value.r#type,
            status: value.status,
            name: value.name,
            target_id: value.target_id,
            conflict_policy: value.conflict_policy,
            item_count: value.item_count,
            completed_count: value.completed_count,
            failed_count: value.failed_count,
            directory_count: value.directory_count,
            directory_failed_count: value.directory_failed_count,
            total: value.total,
            loaded: value.loaded,
            percent: value.percent,
            speed: value.speed,
            estimated_time: value.estimated_time,
            fail_reason: value.fail_reason,
            created_at: value.created_at,
            updated_at: value.updated_at,
            ended_at: value.ended_at,
        }
    }
}
