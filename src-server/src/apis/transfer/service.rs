use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use nanoid::nanoid;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, QuerySelect,
};
use tokio::{
    fs,
    sync::{Mutex, Notify},
    task::JoinHandle,
};

use crate::{
    AppBaseState,
    apis::{
        ApiErr,
        sftp::{get_file_name, parse_file_uri},
    },
    consts::services_err_code::{
        ERR_CODE_DB_ERR, ERR_CODE_SSH_ERR, ERR_CODE_TRANSFER_ERR,
        ERR_CODE_TRANSFER_INVALID_REQUEST, ERR_CODE_TRANSFER_NOT_FOUND,
    },
    entities::transfer_task::{
        ActiveModel, Column, Entity as TransferTaskEntity, Model as TransferTaskModel,
        TransferTaskStatus, TransferTaskType,
    },
    map_db_err, map_ssh_err,
    sftp_client::SftpFileType,
    ssh_connection_pool::ChannelMode,
    target_ssh_service::TargetSshService,
};

use super::{
    dto::{CreateDownloadTaskPayload, CreateUploadTaskPayload},
    ranges::{
        TransferRange, initial_ranges, ranges_from_json, ranges_size, ranges_to_json,
        subtract_range,
    },
};

#[derive(Clone)]
pub struct TransferService {
    pub(super) db: DatabaseConnection,
    pub(super) ssh_service: Arc<TargetSshService>,
    running_tasks: Arc<Mutex<HashMap<String, RunningTask>>>,
    scheduler_notify: Arc<Notify>,
    scheduler_started: Arc<AtomicBool>,
    max_concurrent_tasks: usize,
    pub(super) transfer_chunk_size: usize,
}

struct RunningTask {
    abort: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

#[derive(Debug, PartialEq, Eq)]
enum AbortKind {
    Pause,
    Cancel,
}

impl TransferService {
    pub(crate) fn new(app_state: Arc<AppBaseState>, ssh_service: Arc<TargetSshService>) -> Self {
        let service = Self {
            db: app_state.db.clone(),
            ssh_service,
            running_tasks: Arc::new(Mutex::new(HashMap::new())),
            scheduler_notify: Arc::new(Notify::new()),
            scheduler_started: Arc::new(AtomicBool::new(false)),
            max_concurrent_tasks: app_state.config.transfer_task_concurrency,
            transfer_chunk_size: app_state.config.transfer_chunk_size,
        };
        service
    }

    pub async fn init_pending_tasks(&self) -> Result<(), ApiErr> {
        let now = now_ms();
        let tasks = map_db_err!(
            TransferTaskEntity::find()
                .filter(Column::Status.is_in([TransferTaskStatus::Wait, TransferTaskStatus::Run]))
                .all(&self.db)
                .await
        )?;

        for task in tasks {
            let mut active: ActiveModel = task.into();
            active.status = Set(TransferTaskStatus::Pause);
            active.updated_at = Set(now);
            active.fail_reason = Set(Some("server restarted".to_string()));
            map_db_err!(active.update(&self.db).await)?;
        }

        self.start_scheduler();
        Ok(())
    }

    pub async fn create_upload(
        &self,
        payload: CreateUploadTaskPayload,
    ) -> Result<TransferTaskModel, ApiErr> {
        let local_metadata = fs::metadata(&payload.local_path)
            .await
            .map_err(map_transfer_io_err)?;
        if !local_metadata.is_file() {
            return Err(ApiErr {
                code: ERR_CODE_TRANSFER_INVALID_REQUEST,
                message: "local_path is not a file".to_string(),
            });
        }

        let target_id = parse_file_uri(&payload.target_uri)?.target_id;
        let total = local_metadata.len() as i64;
        let now = now_ms();
        let name = Path::new(&payload.local_path)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| payload.local_path.clone());
        let ranges = initial_ranges(total);

        let task = ActiveModel {
            id: Set(nanoid!()),
            r#type: Set(TransferTaskType::Upload),
            status: Set(TransferTaskStatus::Wait),
            local_path: Set(Some(payload.local_path)),
            target_uri: Set(Some(payload.target_uri)),
            target_id: Set(Some(target_id)),
            name: Set(name),
            loaded: Set(0),
            total: Set(total),
            percent: Set(0.0),
            speed: Set(0),
            estimated_time: Set(None),
            ranges: Set(ranges_to_json(&ranges)?),
            fail_reason: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
            ended_at: Set(None),
        };
        let task = map_db_err!(task.insert(&self.db).await)?;
        self.queue_task(task.id.clone()).await?;
        self.get_task_model(&task.id).await
    }

    pub async fn create_download(
        &self,
        payload: CreateDownloadTaskPayload,
    ) -> Result<TransferTaskModel, ApiErr> {
        let parsed_uri = parse_file_uri(&payload.source_uri)?;
        let target_id = parsed_uri.target_id;
        let source_path = parsed_uri.path.to_string();
        let name = get_file_name(parsed_uri.path);
        if name.is_empty() {
            return Err(ApiErr {
                code: ERR_CODE_TRANSFER_INVALID_REQUEST,
                message: "source_uri path can not end with /".to_string(),
            });
        }

        let local_path = match (payload.local_path, payload.local_dir) {
            (Some(local_path), _) => local_path,
            (None, Some(local_dir)) => PathBuf::from(local_dir)
                .join(&name)
                .to_string_lossy()
                .to_string(),
            (None, None) => {
                return Err(ApiErr {
                    code: ERR_CODE_TRANSFER_INVALID_REQUEST,
                    message: "local_path or local_dir is required".to_string(),
                });
            }
        };

        if let Some(parent) = Path::new(&local_path).parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)
                    .await
                    .map_err(map_transfer_io_err)?;
            }
        }

        let sftp = map_ssh_err!(self.ssh_service.sftp(target_id, ChannelMode::Shared).await)?;
        let attr = map_ssh_err!(sftp.metadata(source_path.as_str()).await)?;
        if attr.file_type() == SftpFileType::Dir {
            return Err(ApiErr {
                code: ERR_CODE_TRANSFER_INVALID_REQUEST,
                message: "source_uri is a directory".to_string(),
            });
        }

        let total = attr.size.unwrap_or(0) as i64;
        let now = now_ms();
        let ranges = initial_ranges(total);

        let task = ActiveModel {
            id: Set(nanoid!()),
            r#type: Set(TransferTaskType::Download),
            status: Set(TransferTaskStatus::Wait),
            local_path: Set(Some(local_path)),
            target_uri: Set(Some(payload.source_uri)),
            target_id: Set(Some(target_id)),
            name: Set(name),
            loaded: Set(0),
            total: Set(total),
            percent: Set(0.0),
            speed: Set(0),
            estimated_time: Set(None),
            ranges: Set(ranges_to_json(&ranges)?),
            fail_reason: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
            ended_at: Set(None),
        };
        let task = map_db_err!(task.insert(&self.db).await)?;
        self.queue_task(task.id.clone()).await?;
        self.get_task_model(&task.id).await
    }

    pub async fn get_task_model(&self, id: &str) -> Result<TransferTaskModel, ApiErr> {
        map_db_err!(
            TransferTaskEntity::find_by_id(id.to_string())
                .one(&self.db)
                .await
        )?
        .ok_or(ApiErr {
            code: ERR_CODE_TRANSFER_NOT_FOUND,
            message: "transfer task not found".to_string(),
        })
    }

    pub async fn list_tasks(&self) -> Result<Vec<TransferTaskModel>, ApiErr> {
        map_db_err!(
            TransferTaskEntity::find()
                .order_by_desc(Column::CreatedAt)
                .all(&self.db)
                .await
        )
    }

    pub async fn delete_task(&self, id: &str) -> Result<(), ApiErr> {
        self.abort_task(id).await;
        let result = map_db_err!(
            TransferTaskEntity::delete_by_id(id.to_string())
                .exec(&self.db)
                .await
        )?;
        if result.rows_affected == 0 {
            return Err(ApiErr {
                code: ERR_CODE_TRANSFER_NOT_FOUND,
                message: "transfer task not found".to_string(),
            });
        }
        Ok(())
    }

    pub async fn pause_task(&self, id: &str) -> Result<TransferTaskModel, ApiErr> {
        self.change_running_task_status(id, AbortKind::Pause).await
    }

    pub async fn cancel_task(&self, id: &str) -> Result<TransferTaskModel, ApiErr> {
        self.change_running_task_status(id, AbortKind::Cancel).await
    }

    pub async fn resume_task(&self, id: &str) -> Result<TransferTaskModel, ApiErr> {
        let task = self.get_task_model(id).await?;
        match task.status {
            TransferTaskStatus::Pause | TransferTaskStatus::Fail => {
                self.queue_task(id.to_string()).await?;
                self.get_task_model(id).await
            }
            _ => Err(ApiErr {
                code: ERR_CODE_TRANSFER_INVALID_REQUEST,
                message: "only PAUSE or FAIL task can resume".to_string(),
            }),
        }
    }

    async fn change_running_task_status(
        &self,
        id: &str,
        kind: AbortKind,
    ) -> Result<TransferTaskModel, ApiErr> {
        let task = self.get_task_model(id).await?;
        if matches!(
            task.status,
            TransferTaskStatus::Success | TransferTaskStatus::Cancel
        ) {
            return Err(ApiErr {
                code: ERR_CODE_TRANSFER_INVALID_REQUEST,
                message: "finished task can not change status".to_string(),
            });
        }

        self.abort_task(id).await;

        let now = now_ms();
        let mut active: ActiveModel = task.into();
        active.status = Set(match kind {
            AbortKind::Pause => TransferTaskStatus::Pause,
            AbortKind::Cancel => TransferTaskStatus::Cancel,
        });
        active.speed = Set(0);
        active.estimated_time = Set(None);
        active.updated_at = Set(now);
        if kind == AbortKind::Cancel {
            active.ended_at = Set(Some(now));
        }
        map_db_err!(active.update(&self.db).await)?;
        self.scheduler_notify.notify_one();
        self.get_task_model(id).await
    }

    async fn queue_task(&self, id: String) -> Result<(), ApiErr> {
        {
            let running_tasks = self.running_tasks.lock().await;
            if running_tasks.contains_key(&id) {
                return Ok(());
            }
        }

        let task = self.get_task_model(&id).await?;
        if matches!(
            task.status,
            TransferTaskStatus::Run | TransferTaskStatus::Success | TransferTaskStatus::Cancel
        ) {
            return Err(ApiErr {
                code: ERR_CODE_TRANSFER_INVALID_REQUEST,
                message: "task can not start".to_string(),
            });
        }

        let mut active: ActiveModel = task.into();
        active.status = Set(TransferTaskStatus::Wait);
        active.fail_reason = Set(None);
        active.updated_at = Set(now_ms());
        map_db_err!(active.update(&self.db).await)?;

        self.start_scheduler();
        self.scheduler_notify.notify_one();
        Ok(())
    }

    fn start_scheduler(&self) {
        if self
            .scheduler_started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }

        let scheduler_service = self.clone();
        tokio::spawn(async move {
            scheduler_service.run_scheduler().await;
        });
    }

    async fn run_scheduler(&self) {
        loop {
            self.dispatch_pending_tasks().await;
            self.scheduler_notify.notified().await;
        }
    }

    async fn dispatch_pending_tasks(&self) {
        loop {
            let running_count = self.running_tasks.lock().await.len();
            if running_count >= self.max_concurrent_tasks {
                return;
            }

            let capacity = self.max_concurrent_tasks - running_count;
            let tasks = TransferTaskEntity::find()
                .filter(Column::Status.eq(TransferTaskStatus::Wait))
                .order_by_asc(Column::CreatedAt)
                .limit(self.max_concurrent_tasks as u64)
                .all(&self.db)
                .await;
            let tasks = match tasks {
                Ok(tasks) => tasks,
                Err(err) => {
                    tracing::warn!("transfer scheduler query failed: {err}");
                    return;
                }
            };
            if tasks.is_empty() {
                return;
            }

            let mut started = 0;
            for task in tasks {
                if started >= capacity {
                    break;
                }
                if self.try_start_task(task.id).await {
                    started += 1;
                }
            }

            if started == 0 {
                return;
            }
        }
    }

    async fn try_start_task(&self, id: String) -> bool {
        {
            let running_tasks = self.running_tasks.lock().await;
            if running_tasks.contains_key(&id) {
                return false;
            }
        }

        let task = match self.get_task_model(&id).await {
            Ok(task) => task,
            Err(err) => {
                tracing::warn!("transfer scheduler get task failed: {}", err.message);
                return false;
            }
        };
        if task.status != TransferTaskStatus::Wait {
            return false;
        }
        if let Err(err) = self.set_status(&id, TransferTaskStatus::Run).await {
            tracing::warn!("transfer scheduler set task run failed: {}", err.message);
            return false;
        }

        let abort = Arc::new(AtomicBool::new(false));
        let handle_service = self.clone();
        let handle_abort = abort.clone();
        let handle_id = id.clone();
        self.running_tasks.lock().await.insert(
            id.clone(),
            RunningTask {
                abort: abort.clone(),
                handle: None,
            },
        );

        let handle = tokio::spawn(async move {
            handle_service.run_task(handle_id, handle_abort).await;
        });
        if let Some(task) = self.running_tasks.lock().await.get_mut(&id) {
            task.handle = Some(handle);
        } else {
            abort.store(true, Ordering::Release);
            handle.abort();
        }

        true
    }

    async fn abort_task(&self, id: &str) {
        if let Some(task) = self.running_tasks.lock().await.remove(id) {
            task.abort.store(true, Ordering::Release);
            if let Some(handle) = task.handle {
                handle.abort();
            }
            self.scheduler_notify.notify_one();
        }
    }

    async fn run_task(&self, id: String, abort: Arc<AtomicBool>) {
        let result = self.run_task_inner(&id, abort.clone()).await;

        self.running_tasks.lock().await.remove(&id);
        self.scheduler_notify.notify_one();

        if let Err(err) = result {
            let task = TransferTaskEntity::find_by_id(id.clone())
                .one(&self.db)
                .await;
            if let Ok(Some(task)) = task {
                if matches!(
                    task.status,
                    TransferTaskStatus::Pause | TransferTaskStatus::Cancel
                ) {
                    return;
                }
                let now = now_ms();
                let mut active: ActiveModel = task.into();
                active.status = Set(TransferTaskStatus::Fail);
                active.fail_reason = Set(Some(err.message));
                active.speed = Set(0);
                active.estimated_time = Set(None);
                active.updated_at = Set(now);
                active.ended_at = Set(Some(now));
                let _ = active.update(&self.db).await;
            }
        }
    }

    async fn run_task_inner(&self, id: &str, abort: Arc<AtomicBool>) -> Result<(), ApiErr> {
        let task = self.get_task_model(id).await?;
        if task.status != TransferTaskStatus::Run {
            return Ok(());
        }

        match task.r#type {
            TransferTaskType::Upload => self.run_upload(id, abort).await?,
            TransferTaskType::Download => self.run_download(id, abort).await?,
        }

        let task = self.get_task_model(id).await?;
        let ranges = ranges_from_json(&task.ranges)?;
        if ranges.is_empty() {
            self.finish_success(task, ranges).await?;
        }

        Ok(())
    }

    async fn set_status(&self, id: &str, status: TransferTaskStatus) -> Result<(), ApiErr> {
        let task = self.get_task_model(id).await?;
        let mut active: ActiveModel = task.into();
        active.status = Set(status);
        active.updated_at = Set(now_ms());
        map_db_err!(active.update(&self.db).await)?;
        Ok(())
    }

    pub(super) async fn mark_range_done(
        &self,
        id: &str,
        done_range: TransferRange,
    ) -> Result<(), ApiErr> {
        let task = self.get_task_model(id).await?;
        if !matches!(
            task.status,
            TransferTaskStatus::Run | TransferTaskStatus::Wait
        ) {
            return Ok(());
        }

        let old_ranges = ranges_from_json(&task.ranges)?;
        let ranges = subtract_range(old_ranges, done_range);
        let loaded = task.total - ranges_size(&ranges);
        let now = now_ms();
        let elapsed_ms = (now - task.updated_at).max(1);
        let speed = ((loaded - task.loaded).max(0) * 1000) / elapsed_ms;
        let remaining = (task.total - loaded).max(0);
        let estimated_time = if speed > 0 {
            Some(remaining / speed)
        } else {
            None
        };
        let percent = if task.total > 0 {
            loaded as f64 * 100.0 / task.total as f64
        } else {
            100.0
        };

        let mut active: ActiveModel = task.into();
        active.ranges = Set(ranges_to_json(&ranges)?);
        active.loaded = Set(loaded);
        active.percent = Set(percent);
        active.speed = Set(speed);
        active.estimated_time = Set(estimated_time);
        active.updated_at = Set(now);
        if ranges.is_empty() {
            active.status = Set(TransferTaskStatus::Success);
            active.percent = Set(100.0);
            active.speed = Set(0);
            active.estimated_time = Set(Some(0));
            active.ended_at = Set(Some(now));
        }
        map_db_err!(active.update(&self.db).await)?;

        Ok(())
    }

    async fn finish_success(
        &self,
        task: TransferTaskModel,
        ranges: Vec<TransferRange>,
    ) -> Result<(), ApiErr> {
        let now = now_ms();
        let mut active: ActiveModel = task.into();
        active.status = Set(TransferTaskStatus::Success);
        active.loaded = Set(active.total.clone().unwrap());
        active.percent = Set(100.0);
        active.speed = Set(0);
        active.estimated_time = Set(Some(0));
        active.ranges = Set(ranges_to_json(&ranges)?);
        active.updated_at = Set(now);
        active.ended_at = Set(Some(now));
        map_db_err!(active.update(&self.db).await)?;
        Ok(())
    }
}

pub fn map_transfer_io_err(err: std::io::Error) -> ApiErr {
    ApiErr {
        code: ERR_CODE_TRANSFER_ERR,
        message: err.to_string(),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}
