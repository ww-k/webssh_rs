use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool},
};

use anyhow::{Context, Result, anyhow};
use tokio::{
    fs::File,
    io::{AsyncSeekExt, AsyncWriteExt},
};

use super::{
    FastSftpClient,
    transfer::{
        DEFAULT_PIPELINE_CHUNK_SIZE, DEFAULT_READ_MAX_IN_FLIGHT, TransferProgress, TransferRange,
        check_range, is_aborted,
    },
};

#[derive(Clone)]
pub struct DownloadOptions {
    pub sftp: FastSftpClient,
    pub remote_path: String,
    pub local_path: PathBuf,
    pub total: u64,
    pub abort: Arc<AtomicBool>,
    pub ranges: Vec<TransferRange>,
    pub chunk_size: usize,
    pub max_in_flight: usize,
    pub progress_chunk_size: usize,
    pub progress: TransferProgress,
}

impl DownloadOptions {
    pub fn new(
        sftp: FastSftpClient,
        remote_path: String,
        local_path: PathBuf,
        total: u64,
        abort: Arc<AtomicBool>,
        ranges: Vec<TransferRange>,
    ) -> Self {
        Self {
            sftp,
            remote_path,
            local_path,
            total,
            abort,
            ranges,
            chunk_size: DEFAULT_PIPELINE_CHUNK_SIZE,
            max_in_flight: DEFAULT_READ_MAX_IN_FLIGHT,
            progress_chunk_size: DEFAULT_PIPELINE_CHUNK_SIZE,
            progress: TransferProgress::default(),
        }
    }
}

pub async fn run_download(options: DownloadOptions) -> Result<()> {
    if options.chunk_size == 0 {
        return Err(anyhow!("download chunk_size must be greater than 0"));
    }
    if options.max_in_flight == 0 {
        return Err(anyhow!("download max_in_flight must be greater than 0"));
    }

    let local_file = File::options()
        .create(true)
        .write(true)
        .read(true)
        .truncate(false)
        .open(&options.local_path)
        .await
        .with_context(|| format!("open {}", options.local_path.display()))?;
    local_file.set_len(options.total).await?;
    drop(local_file);
    if options.ranges.is_empty() {
        flush_local_file(&options.local_path).await?;
        return Ok(());
    }

    let handle = options.sftp.open_read_handle(&options.remote_path).await?;
    let handle: Arc<[u8]> = Arc::from(handle);
    let download_result = run_download_ranges(&options, Arc::clone(&handle)).await;
    let close_result = options.sftp.close(handle.to_vec()).await;

    download_result?;
    close_result?;
    flush_local_file(&options.local_path).await?;
    Ok(())
}

async fn run_download_ranges(options: &DownloadOptions, handle: Arc<[u8]>) -> Result<()> {
    let mut tasks = Vec::with_capacity(options.ranges.len());
    for range in options.ranges.iter().copied() {
        if is_aborted(&options.abort) {
            return Ok(());
        }
        let Some((start, end)) = check_range(range, options.total)? else {
            continue;
        };
        let task = DownloadSlice {
            sftp: options.sftp.clone(),
            handle: Arc::clone(&handle),
            local_path: options.local_path.clone(),
            range: [start, end],
            abort: Arc::clone(&options.abort),
            chunk_size: options.chunk_size,
            max_in_flight: options.max_in_flight,
            progress_chunk_size: options.progress_chunk_size,
            progress: options.progress.clone(),
        };
        tasks.push(tokio::spawn(async move { run_download_slice(task).await }));
    }

    for task in tasks {
        task.await??;
    }
    Ok(())
}

#[derive(Clone)]
pub struct DownloadSlice {
    pub sftp: FastSftpClient,
    pub handle: Arc<[u8]>,
    pub local_path: PathBuf,
    pub range: [u64; 2],
    pub abort: Arc<AtomicBool>,
    pub chunk_size: usize,
    pub max_in_flight: usize,
    pub progress_chunk_size: usize,
    pub progress: TransferProgress,
}

pub async fn run_download_slice(slice: DownloadSlice) -> Result<()> {
    let [start, end] = slice.range;
    let mut local_file = File::options()
        .create(true)
        .write(true)
        .read(true)
        .truncate(false)
        .open(&slice.local_path)
        .await
        .with_context(|| format!("open {}", slice.local_path.display()))?;
    let mut next_offset = start;
    let mut contiguous_done = start;
    let mut progress_start = start;
    let mut pending = VecDeque::new();

    loop {
        while pending.len() < slice.max_in_flight && next_offset <= end {
            if is_aborted(&slice.abort) {
                return Ok(());
            }

            let offset = next_offset;
            let current_chunk_size =
                std::cmp::min(slice.chunk_size as u64, end - next_offset + 1) as usize;
            let read = slice
                .sftp
                .begin_read(Arc::clone(&slice.handle), offset, current_chunk_size)
                .await?;
            pending.push_back((offset, read));
            next_offset += current_chunk_size as u64;
        }

        let Some((offset, read)) = pending.pop_front() else {
            break;
        };
        if offset != contiguous_done {
            return Err(anyhow!(
                "sftp download progress mismatch: expected offset {contiguous_done}, got {offset}"
            ));
        }

        let data = read.wait_data().await?;
        if data.is_empty() {
            return Err(anyhow!(
                "sftp download reached eof before offset {}",
                end + 1
            ));
        }
        let data_end = offset + data.len() as u64 - 1;
        if data_end > end {
            return Err(anyhow!(
                "sftp download read past range end: got {data_end}, expected {end}"
            ));
        }

        write_at(&mut local_file, offset, data.as_slice()).await?;
        contiguous_done = data_end + 1;
        if contiguous_done - progress_start >= slice.progress_chunk_size as u64
            || contiguous_done > end
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
            "sftp download progress mismatch: expected {}, got {contiguous_done}",
            end + 1
        ));
    }

    Ok(())
}

async fn write_at(file: &mut File, offset: u64, data: &[u8]) -> std::io::Result<()> {
    file.seek(std::io::SeekFrom::Start(offset)).await?;
    file.write_all(data).await?;
    Ok(())
}

async fn flush_local_file(path: &PathBuf) -> std::io::Result<()> {
    let mut file = File::options().write(true).open(path).await?;
    file.flush().await
}
