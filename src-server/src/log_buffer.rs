use std::{
    collections::VecDeque,
    io::{self, Write},
    sync::{Arc, Mutex, OnceLock},
};

use tokio::sync::broadcast;

const MAX_LOG_LINES: usize = 2_000;
const LOG_UPDATE_CAPACITY: usize = 1_024;

#[derive(Clone, Debug)]
pub struct LogEntry {
    pub id: u64,
    pub line: String,
}

struct LogBufferState {
    lines: VecDeque<LogEntry>,
    next_id: u64,
    updates: broadcast::Sender<LogEntry>,
}

#[derive(Clone)]
pub struct LogBuffer(Arc<Mutex<LogBufferState>>);

impl Default for LogBuffer {
    fn default() -> Self {
        let (updates, _) = broadcast::channel(LOG_UPDATE_CAPACITY);
        Self(Arc::new(Mutex::new(LogBufferState {
            lines: VecDeque::new(),
            next_id: 0,
            updates,
        })))
    }
}

impl LogBuffer {
    pub fn lines(&self) -> Vec<String> {
        self.0
            .lock()
            .map(|state| state.lines.iter().map(|entry| entry.line.clone()).collect())
            .unwrap_or_default()
    }

    pub fn subscribe_with_snapshot(
        &self,
        after_id: Option<u64>,
    ) -> (
        Vec<LogEntry>,
        Option<u64>,
        broadcast::Receiver<LogEntry>,
        bool,
    ) {
        let Ok(state) = self.0.lock() else {
            let (_, receiver) = broadcast::channel(1);
            return (Vec::new(), None, receiver, true);
        };

        let receiver = state.updates.subscribe();
        let latest_id = state.lines.back().map(|entry| entry.id);
        let snapshot_is_stale = after_id.is_some_and(|id| {
            state
                .lines
                .front()
                .is_some_and(|entry| id.saturating_add(1) < entry.id)
        });
        let entries = state
            .lines
            .iter()
            .filter(|entry| snapshot_is_stale || after_id.is_none_or(|id| entry.id > id))
            .cloned()
            .collect();

        let replace_terminal = after_id.is_none() || snapshot_is_stale;
        (entries, latest_id, receiver, replace_terminal)
    }

    fn push(&self, line: String) {
        if let Ok(mut state) = self.0.lock() {
            state.next_id = state.next_id.wrapping_add(1);
            let entry = LogEntry {
                id: state.next_id,
                line,
            };
            state.lines.push_back(entry.clone());
            if state.lines.len() > MAX_LOG_LINES {
                state.lines.pop_front();
            }
            let _ = state.updates.send(entry);
        }
    }
}

static LOG_BUFFER: OnceLock<LogBuffer> = OnceLock::new();

pub fn log_buffer() -> LogBuffer {
    LOG_BUFFER.get_or_init(LogBuffer::default).clone()
}

#[derive(Clone)]
pub struct LogWriter {
    buffer: LogBuffer,
}

impl LogWriter {
    pub fn new(buffer: LogBuffer) -> Self {
        Self { buffer }
    }
}

pub struct LogWriterGuard {
    buffer: LogBuffer,
    pending: Vec<u8>,
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for LogWriter {
    type Writer = LogWriterGuard;

    fn make_writer(&'a self) -> Self::Writer {
        LogWriterGuard {
            buffer: self.buffer.clone(),
            pending: Vec::new(),
        }
    }
}

impl Write for LogWriterGuard {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        io::stdout().write_all(bytes)?;
        self.pending.extend_from_slice(bytes);
        while let Some(end) = self.pending.iter().position(|byte| *byte == b'\n') {
            let line = String::from_utf8_lossy(&self.pending[..end])
                .trim_end_matches('\r')
                .to_string();
            self.buffer.push(line);
            self.pending.drain(..=end);
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        io::stdout().flush()?;
        if !self.pending.is_empty() {
            self.buffer
                .push(String::from_utf8_lossy(&self.pending).to_string());
            self.pending.clear();
        }
        Ok(())
    }
}
