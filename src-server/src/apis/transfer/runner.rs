use std::{
    collections::VecDeque,
    io::SeekFrom,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    time::Duration,
};

use crate::{
    apis::{ApiErr, sftp::parse_file_uri},
    consts::services_err_code::ERR_CODE_SSH_ERR,
    map_ssh_err,
    sftp_client::{FastSftpClient, SftpAttrs, SftpOpenOptions},
};

use super::{
    ranges::{invalid_task, ranges_from_json},
    service::{TransferService, map_transfer_io_err},
};

const SFTP_PIPELINE_CHUNK_SIZE: usize = 255 * 1024;
const SFTP_PIPELINE_MAX_IN_FLIGHT: usize = 64;
const SFTP_WRITE_RESPONSE_TIMEOUT: Duration = Duration::from_secs(2);
impl TransferService {
    pub(super) async fn run_upload(&self, id: &str, abort: Arc<AtomicBool>) -> Result<(), ApiErr> {
        let task = self.get_task_model(id).await?;
        let chunk_size = self.transfer_chunk_size;
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

        if ranges.len() == 1 && ranges[0] == [0, task.total - 1] {
            return self
                .run_pipelined_sftp_upload(
                    id,
                    uri.target_id,
                    uri.path,
                    &local_path,
                    task.total,
                    abort,
                )
                .await;
        }

        let mut local_file = File::open(local_path).await.map_err(map_transfer_io_err)?;
        let sftp = map_ssh_err!(self.session_pool.get_sftp_session(uri.target_id).await)?;
        let mut remote_file = map_ssh_err!(
            sftp.open_with_flags(
                uri.path,
                SftpOpenOptions::WRITE | SftpOpenOptions::READ | SftpOpenOptions::CREATE
            )
            .await
        )?;
        map_ssh_err!(
            remote_file
                .set_metadata(SftpAttrs::with_size(task.total as u64))
                .await
        )?;

        for range in ranges {
            if abort.load(Ordering::Acquire) {
                return Ok(());
            }
            let [start, end] = range;
            local_file
                .seek(SeekFrom::Start(start as u64))
                .await
                .map_err(map_transfer_io_err)?;
            map_ssh_err!(remote_file.seek(SeekFrom::Start(start as u64)).await)?;

            let mut offset = start;
            while offset <= end {
                if abort.load(Ordering::Acquire) {
                    return Ok(());
                }
                let current_chunk_size =
                    std::cmp::min(chunk_size as i64, end - offset + 1) as usize;
                let mut buffer = vec![0; current_chunk_size];
                local_file
                    .read_exact(&mut buffer)
                    .await
                    .map_err(map_transfer_io_err)?;
                map_ssh_err!(remote_file.write_all(&buffer).await)?;
                offset += current_chunk_size as i64;
                self.mark_range_done(id, [offset - current_chunk_size as i64, offset - 1])
                    .await?;
            }
        }

        map_ssh_err!(remote_file.flush().await)?;
        Ok(())
    }

    pub(super) async fn run_download(
        &self,
        id: &str,
        abort: Arc<AtomicBool>,
    ) -> Result<(), ApiErr> {
        let task = self.get_task_model(id).await?;
        let chunk_size = self.transfer_chunk_size;
        let source_uri = task
            .source_uri
            .clone()
            .ok_or_else(|| invalid_task("missing source_uri"))?;
        let local_path = task
            .local_path
            .clone()
            .ok_or_else(|| invalid_task("missing local_path"))?;
        let uri = parse_file_uri(&source_uri)?;
        let ranges = ranges_from_json(&task.ranges)?;

        let sftp = map_ssh_err!(self.session_pool.get_sftp_session(uri.target_id).await)?;
        let mut remote_file = map_ssh_err!(sftp.open(uri.path).await)?;
        let mut local_file = File::options()
            .create(true)
            .write(true)
            .read(true)
            .open(local_path)
            .await
            .map_err(map_transfer_io_err)?;
        local_file
            .set_len(task.total as u64)
            .await
            .map_err(map_transfer_io_err)?;

        for range in ranges {
            if abort.load(Ordering::Acquire) {
                return Ok(());
            }
            let [start, end] = range;
            map_ssh_err!(remote_file.seek(SeekFrom::Start(start as u64)).await)?;
            local_file
                .seek(SeekFrom::Start(start as u64))
                .await
                .map_err(map_transfer_io_err)?;

            let mut offset = start;
            while offset <= end {
                if abort.load(Ordering::Acquire) {
                    return Ok(());
                }
                let current_chunk_size =
                    std::cmp::min(chunk_size as i64, end - offset + 1) as usize;
                let mut buffer = vec![0; current_chunk_size];
                map_ssh_err!(remote_file.read_exact(&mut buffer).await)?;
                local_file
                    .write_all(&buffer)
                    .await
                    .map_err(map_transfer_io_err)?;
                offset += current_chunk_size as i64;
                self.mark_range_done(id, [offset - current_chunk_size as i64, offset - 1])
                    .await?;
            }
        }

        local_file.flush().await.map_err(map_transfer_io_err)?;
        Ok(())
    }

    async fn run_pipelined_sftp_upload(
        &self,
        id: &str,
        target_id: i32,
        remote_path: &str,
        local_path: &str,
        total: i64,
        abort: Arc<AtomicBool>,
    ) -> Result<(), ApiErr> {
        let mut local_file = File::open(local_path).await.map_err(map_transfer_io_err)?;
        let channel = map_ssh_err!(self.session_pool.get_channel(target_id).await)?;
        let sftp = FastSftpClient::new(channel).await?;
        let handle = sftp.open_upload(remote_path, total as u64).await?;
        sftp.set_size(&handle, total as u64).await?;

        let upload_result = self
            .send_pipelined_sftp_writes(
                id,
                target_id,
                remote_path,
                &sftp,
                &handle,
                &mut local_file,
                total,
                abort,
            )
            .await;
        let close_result = sftp.close(handle).await;
        sftp.shutdown().await;

        if let Err(err) = upload_result {
            let _ = close_result;
            if self
                .remote_file_size_matches(target_id, remote_path, total)
                .await?
            {
                let task = self.get_task_model(id).await?;
                let ranges = ranges_from_json(&task.ranges)?;
                for range in ranges {
                    self.mark_range_done(id, range).await?;
                }
                return Ok(());
            }
            return Err(err);
        }
        if let Err(err) = close_result {
            if self
                .remote_file_size_matches(target_id, remote_path, total)
                .await?
            {
                return Ok(());
            }
            return Err(err);
        }
        Ok(())
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

    async fn send_pipelined_sftp_writes(
        &self,
        id: &str,
        target_id: i32,
        remote_path: &str,
        sftp: &FastSftpClient,
        handle: &[u8],
        local_file: &mut File,
        total: i64,
        abort: Arc<AtomicBool>,
    ) -> Result<(), ApiErr> {
        let mut buffer = vec![0; SFTP_PIPELINE_CHUNK_SIZE];
        let handle: Arc<[u8]> = Arc::from(handle.to_vec());
        let mut next_offset = 0i64;
        let mut contiguous_done = 0i64;
        let mut progress_start = 0i64;
        let mut pending = VecDeque::new();

        loop {
            while pending.len() < SFTP_PIPELINE_MAX_IN_FLIGHT && next_offset < total {
                if abort.load(Ordering::Acquire) {
                    return Ok(());
                }

                let offset = next_offset;
                let current_chunk_size =
                    std::cmp::min(buffer.len() as i64, total - next_offset) as usize;
                local_file
                    .read_exact(&mut buffer[..current_chunk_size])
                    .await
                    .map_err(map_transfer_io_err)?;
                let data = buffer[..current_chunk_size].to_vec();
                let end = offset + data.len() as i64 - 1;
                let write = sftp
                    .begin_write(Arc::clone(&handle), offset as u64, data)
                    .await?;
                pending.push_back((offset, end, write));
                next_offset += current_chunk_size as i64;
            }

            if pending.is_empty() {
                break;
            }

            let Some((start, end, write)) = pending.pop_front() else {
                break;
            };
            let write_result =
                tokio::time::timeout(SFTP_WRITE_RESPONSE_TIMEOUT, write.wait()).await;
            match write_result {
                Ok(result) => result?,
                Err(_) if next_offset == total => {
                    if self
                        .remote_file_size_matches(target_id, remote_path, total)
                        .await?
                    {
                        let task = self.get_task_model(id).await?;
                        let ranges = ranges_from_json(&task.ranges)?;
                        for range in ranges {
                            self.mark_range_done(id, range).await?;
                        }
                        return Ok(());
                    }
                    return Err(ApiErr {
                        code: ERR_CODE_SSH_ERR,
                        message: "sftp write response timeout".to_string(),
                    });
                }
                Err(_) => {
                    return Err(ApiErr {
                        code: ERR_CODE_SSH_ERR,
                        message: "sftp write response timeout".to_string(),
                    });
                }
            }

            if start != contiguous_done {
                return Err(ApiErr {
                    code: ERR_CODE_SSH_ERR,
                    message: format!(
                        "sftp upload progress mismatch: expected offset {contiguous_done}, got {start}"
                    ),
                });
            }
            contiguous_done = end + 1;
            if contiguous_done - progress_start >= self.transfer_chunk_size as i64
                || contiguous_done == total
            {
                self.mark_range_done(id, [progress_start, contiguous_done - 1])
                    .await?;
                progress_start = contiguous_done;
            }
        }

        if contiguous_done != total {
            return Err(ApiErr {
                code: ERR_CODE_SSH_ERR,
                message: format!(
                    "sftp upload progress mismatch: expected {total}, got {contiguous_done}"
                ),
            });
        }

        Ok(())
    }
}
