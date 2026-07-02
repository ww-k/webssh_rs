use std::{
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool},
};

use tokio::sync::Mutex;

use crate::{
    apis::{ApiErr, sftp::parse_file_uri},
    consts::services_err_code::ERR_CODE_SSH_ERR,
    map_ssh_err,
    sftp_client::{
        FastSftpClient,
        download::{DownloadOptions, run_download},
        transfer::{
            DEFAULT_PIPELINE_CHUNK_SIZE, DEFAULT_READ_MAX_IN_FLIGHT, DEFAULT_WRITE_MAX_IN_FLIGHT,
            DEFAULT_WRITE_RESPONSE_TIMEOUT, TransferProgress,
        },
        upload::{UploadOptions, run_upload},
    },
};

use super::{
    ranges::{invalid_task, ranges_from_json},
    service::TransferService,
};

impl TransferService {
    pub(super) async fn run_upload(&self, id: &str, abort: Arc<AtomicBool>) -> Result<(), ApiErr> {
        let task = self.get_task_model(id).await?;
        let local_path = task
            .local_path
            .clone()
            .ok_or_else(|| invalid_task("missing local_path"))?;
        let target_uri = task
            .target_uri
            .clone()
            .ok_or_else(|| invalid_task("missing target_uri"))?;
        let uri = parse_file_uri(&target_uri)?;
        let ranges = ranges_from_json(&task.ranges)?;
        let truncate = ranges.len() == 1 && ranges[0] == [0, task.total - 1];

        let channel = map_ssh_err!(self.session_pool.get_channel(uri.target_id).await)?;
        let sftp = FastSftpClient::new(channel).await?;
        let mut options = UploadOptions::new(
            sftp.clone(),
            PathBuf::from(local_path),
            uri.path.to_string(),
            task.total as u64,
            abort,
            ranges,
        );
        options.chunk_size = DEFAULT_PIPELINE_CHUNK_SIZE;
        options.max_in_flight = DEFAULT_WRITE_MAX_IN_FLIGHT;
        options.progress_chunk_size = self.transfer_chunk_size;
        options.write_timeout = DEFAULT_WRITE_RESPONSE_TIMEOUT;
        options.truncate = truncate;
        options.progress = transfer_progress(self.clone(), id.to_string());

        let upload_result = run_upload(options).await;
        sftp.shutdown().await;

        if let Err(err) = upload_result {
            if self
                .remote_file_size_matches(uri.target_id, uri.path, task.total)
                .await?
            {
                let task = self.get_task_model(id).await?;
                let ranges = ranges_from_json(&task.ranges)?;
                for range in ranges {
                    self.mark_range_done(id, range).await?;
                }
                return Ok(());
            }
            return Err(map_transfer_anyhow_err(err));
        }

        Ok(())
    }

    pub(super) async fn run_download(
        &self,
        id: &str,
        abort: Arc<AtomicBool>,
    ) -> Result<(), ApiErr> {
        let task = self.get_task_model(id).await?;
        let target_uri = task
            .target_uri
            .clone()
            .ok_or_else(|| invalid_task("missing target_uri"))?;
        let local_path = task
            .local_path
            .clone()
            .ok_or_else(|| invalid_task("missing local_path"))?;
        let uri = parse_file_uri(&target_uri)?;
        let ranges = ranges_from_json(&task.ranges)?;

        let channel = map_ssh_err!(self.session_pool.get_channel(uri.target_id).await)?;
        let sftp = FastSftpClient::new(channel).await?;
        let mut options = DownloadOptions::new(
            sftp.clone(),
            uri.path.to_string(),
            PathBuf::from(local_path),
            task.total as u64,
            abort,
            ranges,
        );
        options.chunk_size = DEFAULT_PIPELINE_CHUNK_SIZE;
        options.max_in_flight = DEFAULT_READ_MAX_IN_FLIGHT;
        options.progress_chunk_size = self.transfer_chunk_size;
        options.progress = transfer_progress(self.clone(), id.to_string());

        let download_result = run_download(options).await;
        sftp.shutdown().await;

        download_result.map_err(map_transfer_anyhow_err)
    }

    async fn remote_file_size_matches(
        &self,
        target_id: i32,
        remote_path: &str,
        total: i64,
    ) -> Result<bool, ApiErr> {
        let sftp = map_ssh_err!(self.session_pool.get_sftp_session(target_id).await)?;
        let attr = map_ssh_err!(sftp.metadata(remote_path).await)?;
        Ok(attr.size == Some(total as u64))
    }
}

fn transfer_progress(service: TransferService, id: String) -> TransferProgress {
    let progress_lock = Arc::new(Mutex::new(()));
    TransferProgress::new(move |range| {
        let service = service.clone();
        let id = id.clone();
        let progress_lock = Arc::clone(&progress_lock);
        async move {
            let _guard = progress_lock.lock().await;
            service
                .mark_range_done(&id, range)
                .await
                .map_err(|err| anyhow::anyhow!(err.message))
        }
    })
}

fn map_transfer_anyhow_err(err: anyhow::Error) -> ApiErr {
    ApiErr {
        code: ERR_CODE_SSH_ERR,
        message: err.to_string(),
    }
}
