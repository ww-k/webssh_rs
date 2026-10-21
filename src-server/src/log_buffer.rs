use std::{
    collections::VecDeque,
    io::{self, Write},
    sync::{Arc, Mutex, OnceLock},
};

const MAX_LOG_LINES: usize = 2_000;

#[derive(Clone, Default)]
pub struct LogBuffer(Arc<Mutex<VecDeque<String>>>);

impl LogBuffer {
    pub fn lines(&self) -> Vec<String> {
        self.0
            .lock()
            .map(|lines| lines.iter().cloned().collect())
            .unwrap_or_default()
    }

    fn push(&self, line: String) {
        if let Ok(mut lines) = self.0.lock() {
            lines.push_back(line);
            if lines.len() > MAX_LOG_LINES {
                lines.pop_front();
            }
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
