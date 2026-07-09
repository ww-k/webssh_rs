use std::{
    future::Future,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use anyhow::{Result, anyhow};

pub type TransferRange = [i64; 2];
pub type ProgressFuture = Pin<Box<dyn Future<Output = Result<()>> + Send>>;
pub type ProgressCallback = Arc<dyn Fn(TransferRange) -> ProgressFuture + Send + Sync>;

pub const DEFAULT_PIPELINE_CHUNK_SIZE: usize = 255 * 1024;
pub const DEFAULT_READ_PIPELINE_CHUNK_SIZE: usize = 128 * 1024;
pub const DEFAULT_READ_MAX_IN_FLIGHT: usize = 48;
pub const DEFAULT_WRITE_MAX_IN_FLIGHT: usize = 64;
pub const DEFAULT_WRITE_RESPONSE_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone)]
pub struct TransferProgress {
    callback: Option<ProgressCallback>,
}

impl TransferProgress {
    pub fn new<F, Fut>(callback: F) -> Self
    where
        F: Fn(TransferRange) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<()>> + Send + 'static,
    {
        Self {
            callback: Some(Arc::new(move |range| Box::pin(callback(range)))),
        }
    }

    pub async fn mark(&self, range: TransferRange) -> Result<()> {
        if let Some(callback) = &self.callback {
            callback(range).await?;
        }
        Ok(())
    }
}

impl Default for TransferProgress {
    fn default() -> Self {
        Self { callback: None }
    }
}

pub fn check_range(range: TransferRange, total: u64) -> Result<Option<(u64, u64)>> {
    let [start, end] = range;
    if start < 0 || end < start {
        return Err(anyhow!("invalid transfer range [{start}, {end}]"));
    }
    if total == 0 {
        return Ok(None);
    }
    let start = start as u64;
    let end = end as u64;
    if end >= total {
        return Err(anyhow!(
            "transfer range [{start}, {end}] exceeds total {total}"
        ));
    }
    Ok(Some((start, end)))
}

pub fn is_aborted(abort: &Arc<AtomicBool>) -> bool {
    abort.load(Ordering::Acquire)
}
