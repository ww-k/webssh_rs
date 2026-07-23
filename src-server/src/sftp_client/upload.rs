use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool},
    time::Duration,
};

use anyhow::{Context, Result, anyhow};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt},
};

use super::{
    FastSftpClient,
    transfer::{
        DEFAULT_PIPELINE_CHUNK_SIZE, DEFAULT_WRITE_MAX_IN_FLIGHT, DEFAULT_WRITE_RESPONSE_TIMEOUT,
        TransferProgress, TransferRange, check_range, is_aborted,
    },
};

#[derive(Clone)]
pub struct UploadOptions {
    pub sftp: FastSftpClient,
    pub local_path: PathBuf,
    pub remote_path: String,
    pub total: u64,
    pub abort: Arc<AtomicBool>,
    pub ranges: Vec<TransferRange>,
    pub chunk_size: usize,
    pub max_in_flight: usize,
    pub progress_chunk_size: usize,
    pub write_timeout: Duration,
    pub truncate: bool,
    pub progress: TransferProgress,
}

impl UploadOptions {
    pub fn new(
        sftp: FastSftpClient,
        local_path: PathBuf,
        remote_path: String,
        total: u64,
        abort: Arc<AtomicBool>,
        ranges: Vec<TransferRange>,
    ) -> Self {
        Self {
            sftp,
            local_path,
            remote_path,
            total,
            abort,
            ranges,
            chunk_size: DEFAULT_PIPELINE_CHUNK_SIZE,
            max_in_flight: DEFAULT_WRITE_MAX_IN_FLIGHT,
            progress_chunk_size: DEFAULT_PIPELINE_CHUNK_SIZE,
            write_timeout: DEFAULT_WRITE_RESPONSE_TIMEOUT,
            truncate: true,
            progress: TransferProgress::default(),
        }
    }
}

pub async fn run_upload(options: UploadOptions) -> Result<()> {
    if options.chunk_size == 0 {
        return Err(anyhow!("upload chunk_size must be greater than 0"));
    }
    if options.max_in_flight == 0 {
        return Err(anyhow!("upload max_in_flight must be greater than 0"));
    }

    let handle = if options.truncate {
        options
            .sftp
            .open_upload(&options.remote_path, options.total)
            .await?
    } else {
        options.sftp.open_upload_range(&options.remote_path).await?
    };
    let handle: Arc<[u8]> = Arc::from(handle);
    options
        .sftp
        .set_size(handle.as_ref(), options.total)
        .await?;

    let upload_result = run_upload_ranges(&options, Arc::clone(&handle)).await;
    let close_result = options.sftp.close(handle.to_vec()).await;

    upload_result?;
    close_result?;
    Ok(())
}

async fn run_upload_ranges(options: &UploadOptions, handle: Arc<[u8]>) -> Result<()> {
    let mut tasks = Vec::with_capacity(options.ranges.len());
    for range in options.ranges.iter().copied() {
        if is_aborted(&options.abort) {
            return Ok(());
        }
        let Some((start, end)) = check_range(range, options.total)? else {
            continue;
        };
        let task = UploadSlice {
            sftp: options.sftp.clone(),
            handle: Arc::clone(&handle),
            local_path: options.local_path.clone(),
            range: [start, end],
            abort: Arc::clone(&options.abort),
            chunk_size: options.chunk_size,
            max_in_flight: options.max_in_flight,
            progress_chunk_size: options.progress_chunk_size,
            write_timeout: options.write_timeout,
            progress: options.progress.clone(),
        };
        tasks.push(tokio::spawn(async move { run_upload_slice(task).await }));
    }

    for task in tasks {
        task.await??;
    }
    Ok(())
}

#[derive(Clone)]
pub struct UploadSlice {
    pub sftp: FastSftpClient,
    pub handle: Arc<[u8]>,
    pub local_path: PathBuf,
    pub range: [u64; 2],
    pub abort: Arc<AtomicBool>,
    pub chunk_size: usize,
    pub max_in_flight: usize,
    pub progress_chunk_size: usize,
    pub write_timeout: Duration,
    pub progress: TransferProgress,
}

pub async fn run_upload_slice(slice: UploadSlice) -> Result<()> {
    let [start, end] = slice.range;
    let mut local_file = File::open(&slice.local_path)
        .await
        .with_context(|| format!("open {}", slice.local_path.display()))?;
    let mut buffer = vec![0; slice.chunk_size];
    let mut next_offset = start;
    let mut contiguous_done = start;
    let mut progress_start = start;
    let track_progress = slice.progress.is_enabled();
    let mut pending = VecDeque::new();

    loop {
        while pending.len() < slice.max_in_flight && next_offset <= end {
            if is_aborted(&slice.abort) {
                return Ok(());
            }

            let offset = next_offset;
            let current_chunk_size =
                std::cmp::min(buffer.len() as u64, end - next_offset + 1) as usize;
            read_at(&mut local_file, offset, &mut buffer[..current_chunk_size]).await?;
            let data: Box<[u8]> = buffer[..current_chunk_size].into();
            let write_end = offset + data.len() as u64 - 1;
            let write = slice
                .sftp
                .begin_write(Arc::clone(&slice.handle), offset, data)
                .await?;
            pending.push_back((offset, write_end, write));
            next_offset += current_chunk_size as u64;
        }

        let Some((write_start, write_end, write)) = pending.pop_front() else {
            break;
        };
        tokio::time::timeout(slice.write_timeout, write.wait())
            .await
            .context("sftp write response timeout")??;

        if write_start != contiguous_done {
            return Err(anyhow!(
                "sftp upload progress mismatch: expected offset {contiguous_done}, got {write_start}"
            ));
        }
        contiguous_done = write_end + 1;
        if track_progress
            && (contiguous_done - progress_start >= slice.progress_chunk_size as u64
                || contiguous_done > end)
        {
            slice
                .progress
                .mark([progress_start as i64, contiguous_done as i64 - 1])
                .await?;
            progress_start = contiguous_done;
        }
    }

    if contiguous_done <= end {
        return Err(anyhow!(
            "sftp upload progress mismatch: expected {}, got {contiguous_done}",
            end + 1
        ));
    }

    Ok(())
}

async fn read_at(file: &mut File, offset: u64, buffer: &mut [u8]) -> Result<()> {
    file.seek(std::io::SeekFrom::Start(offset)).await?;
    file.read_exact(buffer).await?;
    Ok(())
}
