use std::{
    io::SeekFrom,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use russh_sftp::protocol::{FileAttributes, OpenFlags};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
};

use crate::{apis::ApiErr, consts::services_err_code::ERR_CODE_SSH_ERR, map_ssh_err};

use super::{
    ranges::{invalid_task, ranges_from_json},
    service::{TransferService, map_transfer_io_err},
    sftp_uri::parse_sftp_uri,
};

const CHUNK_SIZE: usize = 1024 * 1024;

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
        let uri = parse_sftp_uri(&target_uri)?;
        let ranges = ranges_from_json(&task.ranges)?;

        let mut local_file = File::open(local_path).await.map_err(map_transfer_io_err)?;
        let sftp = map_ssh_err!(self.session_pool.get_sftp_session(uri.target_id).await)?;
        let mut remote_file = map_ssh_err!(
            sftp.open_with_flags(
                uri.path,
                OpenFlags::WRITE | OpenFlags::READ | OpenFlags::CREATE
            )
            .await
        )?;
        map_ssh_err!(
            remote_file
                .set_metadata(FileAttributes {
                    size: Some(task.total as u64),
                    ..FileAttributes::empty()
                })
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
                let chunk_size = std::cmp::min(CHUNK_SIZE as i64, end - offset + 1) as usize;
                let mut buffer = vec![0; chunk_size];
                local_file
                    .read_exact(&mut buffer)
                    .await
                    .map_err(map_transfer_io_err)?;
                map_ssh_err!(remote_file.write_all(&buffer).await)?;
                offset += chunk_size as i64;
                self.mark_range_done(id, [offset - chunk_size as i64, offset - 1])
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
        let source_uri = task
            .source_uri
            .clone()
            .ok_or_else(|| invalid_task("missing source_uri"))?;
        let local_path = task
            .local_path
            .clone()
            .ok_or_else(|| invalid_task("missing local_path"))?;
        let uri = parse_sftp_uri(&source_uri)?;
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
                let chunk_size = std::cmp::min(CHUNK_SIZE as i64, end - offset + 1) as usize;
                let mut buffer = vec![0; chunk_size];
                map_ssh_err!(remote_file.read_exact(&mut buffer).await)?;
                local_file
                    .write_all(&buffer)
                    .await
                    .map_err(map_transfer_io_err)?;
                offset += chunk_size as i64;
                self.mark_range_done(id, [offset - chunk_size as i64, offset - 1])
                    .await?;
            }
        }

        local_file.flush().await.map_err(map_transfer_io_err)?;
        Ok(())
    }
}
