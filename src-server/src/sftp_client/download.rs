use std::{
    collections::{BTreeMap, VecDeque},
    fs::OpenOptions,
    io::{Seek, Write},
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool},
};

use anyhow::{Context, Result, anyhow};

use super::{
    FastSftpClient,
    transfer::{
        DEFAULT_PROGRESS_INTERVAL, DEFAULT_READ_MAX_IN_FLIGHT, DEFAULT_READ_PIPELINE_CHUNK_SIZE,
        DEFAULT_READ_RESPONSE_TIMEOUT, TransferProgress, TransferRange, check_range, is_aborted,
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
    pub read_timeout: std::time::Duration,
    pub progress_interval: std::time::Duration,
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
            chunk_size: DEFAULT_READ_PIPELINE_CHUNK_SIZE,
            max_in_flight: DEFAULT_READ_MAX_IN_FLIGHT,
            read_timeout: DEFAULT_READ_RESPONSE_TIMEOUT,
            progress_interval: DEFAULT_PROGRESS_INTERVAL,
            progress_chunk_size: DEFAULT_READ_PIPELINE_CHUNK_SIZE,
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

    let full_single_range = is_full_single_range(&options.ranges, options.total);
    let local_file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(full_single_range)
        .open(&options.local_path)
        .with_context(|| format!("open {}", options.local_path.display()))?;
    if !full_single_range {
        local_file.set_len(options.total)?;
    }
    drop(local_file);
    if options.ranges.is_empty() {
        return Ok(());
    }

    let handle = options.sftp.open_read_handle(&options.remote_path).await?;
    let handle: Arc<[u8]> = Arc::from(handle);
    let download_result = run_download_ranges(&options, Arc::clone(&handle)).await;
    let close_result = options.sftp.close(handle.to_vec()).await;

    download_result?;
    close_result?;
    Ok(())
}

fn is_full_single_range(ranges: &[TransferRange], total: u64) -> bool {
    total > 0 && ranges.len() == 1 && ranges[0] == [0, total as i64 - 1]
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
            read_timeout: options.read_timeout,
            progress_interval: options.progress_interval,
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
    pub read_timeout: std::time::Duration,
    pub progress_interval: std::time::Duration,
    pub progress_chunk_size: usize,
    pub progress: TransferProgress,
}

pub async fn run_download_slice(slice: DownloadSlice) -> Result<()> {
    let [start, end] = slice.range;
    let mut local_file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(&slice.local_path)
        .with_context(|| format!("open {}", slice.local_path.display()))?;
    local_file.seek(std::io::SeekFrom::Start(start))?;
    let mut next_offset = start;
    let mut contiguous_done = start;
    let mut progress_start = start;
    let mut progress_updated_at = std::time::Instant::now();
    let mut read_stream = slice.sftp.read_stream();
    let mut pending_responses = BTreeMap::new();
    let mut request_ends = BTreeMap::new();
    let mut retry_requests = VecDeque::new();
    let mut in_flight = 0usize;
    let mut read_requests = Vec::with_capacity(slice.max_in_flight);
    let track_progress = slice.progress.is_enabled();

    loop {
        read_requests.clear();
        while in_flight + pending_responses.len() + read_requests.len() < slice.max_in_flight {
            if is_aborted(&slice.abort) {
                return Ok(());
            }

            let (offset, current_chunk_size) = if let Some(request) = retry_requests.pop_front() {
                request
            } else if next_offset <= end {
                let offset = next_offset;
                let current_chunk_size =
                    std::cmp::min(slice.chunk_size as u64, end - next_offset + 1) as usize;
                next_offset += current_chunk_size as u64;
                (offset, current_chunk_size)
            } else {
                break;
            };
            read_requests.push((offset, current_chunk_size));
        }
        let started = read_stream
            .begin_reads(Arc::clone(&slice.handle), &read_requests)
            .await?;
        in_flight += started;
        for &(offset, len) in read_requests.iter().take(started) {
            request_ends.insert(offset, offset + len as u64 - 1);
        }

        let (offset, requested_end, data) =
            if let Some((requested_end, data)) = pending_responses.remove(&contiguous_done) {
                (contiguous_done, requested_end, data)
            } else if in_flight > 0 {
                loop {
                    let (offset, data) =
                        tokio::time::timeout(slice.read_timeout, read_stream.recv_data())
                            .await
                            .context("sftp download read response timeout")??;
                    in_flight -= 1;
                    let requested_end = request_ends.remove(&offset).ok_or_else(|| {
                        anyhow!("missing sftp download request for response offset {offset}")
                    })?;
                    if offset == contiguous_done {
                        break (offset, requested_end, data);
                    }
                    if pending_responses
                        .insert(offset, (requested_end, data))
                        .is_some()
                    {
                        return Err(anyhow!(
                            "duplicate sftp download response for offset {offset}"
                        ));
                    }
                }
            } else {
                break;
            };
        if data.is_empty() {
            return Err(anyhow!(
                "sftp download reached eof before offset {}",
                end + 1
            ));
        }
        let data_end = offset + data.len() as u64 - 1;
        if data_end > requested_end {
            return Err(anyhow!(
                "sftp download read past request end: got {data_end}, expected {requested_end}"
            ));
        }

        data.write_all_to(&mut local_file)?;
        contiguous_done = data_end + 1;
        if data_end < requested_end {
            retry_requests.push_front((contiguous_done, (requested_end - data_end) as usize));
        }
        if track_progress
            && (contiguous_done - progress_start >= slice.progress_chunk_size as u64
                || progress_updated_at.elapsed() >= slice.progress_interval
                || contiguous_done > end)
        {
            slice
                .progress
                .mark([progress_start as i64, contiguous_done as i64 - 1])
                .await?;
            progress_start = contiguous_done;
            progress_updated_at = std::time::Instant::now();
        }
    }

    if contiguous_done <= end {
        return Err(anyhow!(
            "sftp download progress mismatch: expected {}, got {contiguous_done}",
            end + 1
        ));
    }

    local_file.flush()?;
    Ok(())
}
