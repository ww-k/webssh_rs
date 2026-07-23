pub mod download;
pub mod transfer;
pub mod upload;

use std::{
    collections::{HashMap, VecDeque},
    io::SeekFrom,
    ops::BitOr,
    sync::{Arc, atomic::AtomicU32},
};

use bytes::Bytes;
use russh::{Channel, ChannelMsg, ChannelReadHalf, ChannelWriteHalf, client::Msg};
use smallvec::SmallVec;
#[cfg(test)]
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::{
    io::{AsyncWrite, AsyncWriteExt},
    sync::{Mutex, mpsc, oneshot},
    task::JoinHandle,
};

use crate::ssh_connection_pool::{SshChannelGuard, SshChannelTransferGuard};

pub type SftpResult<T> = Result<T, SftpError>;

#[derive(Debug, Clone)]
#[non_exhaustive]
pub enum SftpError {
    Io(Arc<std::io::Error>),
    Ssh(Arc<russh::Error>),
    Status { code: u32, message: String },
    UnexpectedPacket { expected: &'static str, actual: u8 },
    Protocol(String),
    ResponseChannelClosed,
    ReadStreamClosed,
    Shutdown,
    Aborted,
}

impl std::fmt::Display for SftpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(err) => err.fmt(f),
            Self::Ssh(err) => err.fmt(f),
            Self::Status { code, message } => write!(f, "sftp status {code}: {message}"),
            Self::UnexpectedPacket { expected, actual } => {
                write!(f, "expected SFTP {expected}, got {actual}")
            }
            Self::Protocol(message) => f.write_str(message),
            Self::ResponseChannelClosed => f.write_str("sftp response channel closed"),
            Self::ReadStreamClosed => f.write_str("sftp read stream closed"),
            Self::Shutdown => f.write_str("sftp client shutdown"),
            Self::Aborted => f.write_str("sftp client aborted"),
        }
    }
}

impl std::error::Error for SftpError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(err) => Some(err.as_ref()),
            Self::Ssh(err) => Some(err.as_ref()),
            _ => None,
        }
    }
}

impl From<std::io::Error> for SftpError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(Arc::new(err))
    }
}

impl From<russh::Error> for SftpError {
    fn from(err: russh::Error) -> Self {
        Self::Ssh(Arc::new(err))
    }
}

#[cfg(test)]
trait AsyncReadWrite: AsyncRead + AsyncWrite + Unpin + Send {}

#[cfg(test)]
impl<T> AsyncReadWrite for T where T: AsyncRead + AsyncWrite + Unpin + Send {}

#[cfg(test)]
type AsyncSftpReader = tokio::io::ReadHalf<Box<dyn AsyncReadWrite>>;
type AsyncSftpWriter = Box<dyn AsyncWrite + Unpin + Send>;

enum SftpPacketReader {
    #[cfg(test)]
    Async(AsyncSftpReader),
    Channel(ChannelDataReader),
}

struct ChannelDataReader {
    channel: ChannelReadHalf,
    current: Option<ChannelDataBuffer>,
}

struct ChannelDataBuffer {
    data: Bytes,
    offset: usize,
}

const SSH_FXP_INIT: u8 = 1;
const SSH_FXP_VERSION: u8 = 2;
const SSH_FXP_OPEN: u8 = 3;
const SSH_FXP_CLOSE: u8 = 4;
const SSH_FXP_READ: u8 = 5;
const SSH_FXP_WRITE: u8 = 6;
const SSH_FXP_STAT: u8 = 17;
const SSH_FXP_FSETSTAT: u8 = 10;
const SSH_FXP_OPENDIR: u8 = 11;
const SSH_FXP_READDIR: u8 = 12;
const SSH_FXP_REMOVE: u8 = 13;
const SSH_FXP_MKDIR: u8 = 14;
const SSH_FXP_RENAME: u8 = 18;
const SSH_FXP_STATUS: u8 = 101;
const SSH_FXP_HANDLE: u8 = 102;
const SSH_FXP_DATA: u8 = 103;
const SSH_FXP_NAME: u8 = 104;
const SSH_FXP_ATTRS: u8 = 105;

const SSH_FX_OK: u32 = 0;
const SSH_FX_EOF: u32 = 1;

const SSH_FXF_READ: u32 = 0x0000_0001;
const SSH_FXF_WRITE: u32 = 0x0000_0002;
const SSH_FXF_APPEND: u32 = 0x0000_0004;
const SSH_FXF_CREAT: u32 = 0x0000_0008;
const SSH_FXF_TRUNC: u32 = 0x0000_0010;
const SSH_FXF_EXCL: u32 = 0x0000_0020;

const SSH_FILEXFER_ATTR_SIZE: u32 = 0x0000_0001;
const SSH_FILEXFER_ATTR_UIDGID: u32 = 0x0000_0002;
const SSH_FILEXFER_ATTR_PERMISSIONS: u32 = 0x0000_0004;
const SSH_FILEXFER_ATTR_ACMODTIME: u32 = 0x0000_0008;
const SSH_FILEXFER_ATTR_EXTENDED: u32 = 0x8000_0000;
const FAST_SFTP_MAX_DATA_LEN: usize = 255 * 1024;
const S_IFMT: u32 = 0o170000;
const S_IFDIR: u32 = 0o040000;
const S_IFREG: u32 = 0o100000;
const S_IFLNK: u32 = 0o120000;

pub struct FastSftpFile {
    client: FastSftpClient,
    handle: Arc<[u8]>,
    offset: u64,
}

pub struct PendingSftpWrite {
    rx: oneshot::Receiver<SftpResult<ResponsePacket>>,
}

pub struct PendingSftpRead {
    rx: oneshot::Receiver<SftpResult<ResponsePacket>>,
}

pub struct SftpReadStream {
    client: FastSftpClient,
    tx: mpsc::UnboundedSender<SftpResult<(u64, ResponsePacket)>>,
    rx: mpsc::UnboundedReceiver<SftpResult<(u64, ResponsePacket)>>,
    ids: Vec<u32>,
    request_packets: Vec<u8>,
}

#[derive(Debug)]
pub struct SftpReadData {
    payload: SftpReadPayload,
    data_len: usize,
}

#[derive(Debug)]
enum SftpReadPayload {
    Contiguous { payload: Vec<u8>, data_start: usize },
    Segmented(SmallVec<[Bytes; 4]>),
}

impl SftpReadData {
    pub fn is_empty(&self) -> bool {
        self.data_len == 0
    }

    pub fn len(&self) -> usize {
        self.data_len
    }

    pub fn write_all_to<W: std::io::Write>(&self, writer: &mut W) -> SftpResult<()> {
        match &self.payload {
            SftpReadPayload::Contiguous {
                payload,
                data_start,
            } => {
                writer.write_all(&payload[*data_start..*data_start + self.data_len])?;
                Ok(())
            }
            SftpReadPayload::Segmented(segments) => {
                let mut slices = segments
                    .iter()
                    .map(|segment| std::io::IoSlice::new(segment.as_ref()))
                    .collect::<SmallVec<[_; 4]>>();
                let mut remaining = slices.as_mut_slice();
                while !remaining.is_empty() {
                    let written = writer.write_vectored(remaining)?;
                    if written == 0 {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::WriteZero,
                            "failed to write sftp data",
                        )
                        .into());
                    }
                    std::io::IoSlice::advance_slices(&mut remaining, written);
                }
                Ok(())
            }
        }
    }

    pub fn into_vec(self) -> Vec<u8> {
        match self.payload {
            SftpReadPayload::Contiguous {
                mut payload,
                data_start,
            } => {
                if data_start == payload.len() {
                    return Vec::new();
                }
                let mut data = payload.split_off(data_start);
                data.truncate(self.data_len);
                data
            }
            SftpReadPayload::Segmented(segments) => {
                let mut data = Vec::with_capacity(self.data_len);
                for segment in segments {
                    data.extend_from_slice(segment.as_ref());
                }
                data
            }
        }
    }

    fn empty() -> Self {
        Self {
            payload: SftpReadPayload::Contiguous {
                payload: Vec::new(),
                data_start: 0,
            },
            data_len: 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SftpFileType {
    Dir,
    File,
    Symlink,
    Other,
}

impl SftpFileType {
    pub fn is_dir(self) -> bool {
        matches!(self, Self::Dir)
    }
}

#[derive(Debug, Clone)]
pub struct SftpAttrs {
    pub size: Option<u64>,
    pub uid: Option<u32>,
    pub user: Option<String>,
    pub gid: Option<u32>,
    pub group: Option<String>,
    pub permissions: Option<u32>,
    pub atime: Option<u32>,
    pub mtime: Option<u32>,
}

impl SftpAttrs {
    pub fn empty() -> Self {
        Self {
            size: None,
            uid: None,
            user: None,
            gid: None,
            group: None,
            permissions: None,
            atime: None,
            mtime: None,
        }
    }

    pub fn with_size(size: u64) -> Self {
        Self {
            size: Some(size),
            ..Self::empty()
        }
    }

    pub fn file_type(&self) -> SftpFileType {
        match self.permissions.unwrap_or_default() & S_IFMT {
            S_IFDIR => SftpFileType::Dir,
            S_IFREG => SftpFileType::File,
            S_IFLNK => SftpFileType::Symlink,
            _ => SftpFileType::Other,
        }
    }

    pub fn permissions_string(&self) -> String {
        let permissions = self.permissions.unwrap_or_default();
        [
            (0o400, 'r'),
            (0o200, 'w'),
            (0o100, 'x'),
            (0o040, 'r'),
            (0o020, 'w'),
            (0o010, 'x'),
            (0o004, 'r'),
            (0o002, 'w'),
            (0o001, 'x'),
        ]
        .into_iter()
        .map(|(flag, value)| {
            if permissions & flag == flag {
                value
            } else {
                '-'
            }
        })
        .collect()
    }
}

#[derive(Debug, Clone)]
pub struct SftpDirEntry {
    name: String,
    attrs: SftpAttrs,
}

impl SftpDirEntry {
    pub fn file_name(&self) -> &str {
        &self.name
    }

    pub fn into_parts(self) -> (String, SftpAttrs) {
        (self.name, self.attrs)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SftpOpenOptions(u32);

impl SftpOpenOptions {
    pub const READ: Self = Self(0x0000_0001);
    pub const WRITE: Self = Self(0x0000_0002);
    pub const APPEND: Self = Self(0x0000_0004);
    pub const CREATE: Self = Self(0x0000_0008);
    pub const TRUNCATE: Self = Self(0x0000_0010);
    pub const EXCLUDE: Self = Self(0x0000_0020);

    fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }

    fn bits(self) -> u32 {
        let mut bits = 0;
        if self.contains(Self::READ) {
            bits |= SSH_FXF_READ;
        }
        if self.contains(Self::WRITE) {
            bits |= SSH_FXF_WRITE;
        }
        if self.contains(Self::APPEND) {
            bits |= SSH_FXF_APPEND;
        }
        if self.contains(Self::CREATE) {
            bits |= SSH_FXF_CREAT;
        }
        if self.contains(Self::TRUNCATE) {
            bits |= SSH_FXF_TRUNC;
        }
        if self.contains(Self::EXCLUDE) {
            bits |= SSH_FXF_EXCL;
        }
        bits
    }
}

impl BitOr for SftpOpenOptions {
    type Output = Self;

    fn bitor(self, rhs: Self) -> Self::Output {
        Self(self.0 | rhs.0)
    }
}

impl FastSftpFile {
    pub async fn set_metadata(&self, metadata: SftpAttrs) -> SftpResult<()> {
        Ok(self
            .client
            .set_handle_metadata(self.handle.as_ref(), metadata)
            .await?)
    }

    pub async fn seek(&mut self, pos: SeekFrom) -> SftpResult<u64> {
        let offset = match pos {
            SeekFrom::Start(offset) => offset,
            SeekFrom::Current(delta) if delta >= 0 => self.offset.saturating_add(delta as u64),
            SeekFrom::Current(delta) => {
                self.offset
                    .checked_sub(delta.unsigned_abs())
                    .ok_or_else(|| {
                        SftpError::from(std::io::Error::new(
                            std::io::ErrorKind::InvalidInput,
                            "negative seek before start",
                        ))
                    })?
            }
            SeekFrom::End(_) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Unsupported,
                    "seek from end is not supported for sftp file",
                )
                .into());
            }
        };
        self.offset = offset;
        Ok(offset)
    }

    pub async fn read_exact(&mut self, buf: &mut [u8]) -> SftpResult<usize> {
        let mut read_total = 0;
        while read_total < buf.len() {
            let read_len = std::cmp::min(FAST_SFTP_MAX_DATA_LEN, buf.len() - read_total);
            let data = self
                .client
                .read_at(self.handle.as_ref(), self.offset, read_len)
                .await?;
            if data.is_empty() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "sftp read reached eof",
                )
                .into());
            }

            let copied = data.len().min(buf.len() - read_total);
            buf[read_total..read_total + copied].copy_from_slice(&data[..copied]);
            read_total += copied;
            self.offset += copied as u64;
        }

        Ok(read_total)
    }

    pub async fn write_all(&mut self, buf: &[u8]) -> SftpResult<()> {
        for chunk in buf.chunks(FAST_SFTP_MAX_DATA_LEN) {
            self.client
                .write(Arc::clone(&self.handle), self.offset, chunk.into())
                .await?;
            self.offset += chunk.len() as u64;
        }
        Ok(())
    }

    pub async fn flush(&mut self) -> SftpResult<()> {
        Ok(())
    }
}

impl Drop for FastSftpFile {
    fn drop(&mut self) {
        let client = self.client.clone();
        let handle = Arc::clone(&self.handle);
        tokio::spawn(async move {
            let _ = client.close_arc(handle).await;
        });
    }
}

#[derive(Clone)]
pub struct FastSftpClient {
    inner: Arc<FastSftpInner>,
    read_task: Arc<Mutex<Option<JoinHandle<()>>>>,
}

pub struct SftpClientGuard {
    client: Option<FastSftpClient>,
}

impl SftpClientGuard {
    pub(crate) fn new(client: FastSftpClient) -> Self {
        Self {
            client: Some(client),
        }
    }

    pub async fn shutdown(mut self) {
        let Some(client) = self.client.take() else {
            return;
        };
        let cleanup = tokio::spawn(async move {
            client.shutdown().await;
        });
        let _ = cleanup.await;
    }
}

impl std::ops::Deref for SftpClientGuard {
    type Target = FastSftpClient;

    fn deref(&self) -> &Self::Target {
        self.client.as_ref().expect("SFTP client guard is empty")
    }
}

impl Drop for SftpClientGuard {
    fn drop(&mut self) {
        let Some(client) = self.client.take() else {
            return;
        };
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                client.abort().await;
            });
        }
    }
}

struct FastSftpInner {
    writer: Mutex<AsyncSftpWriter>,
    pending: Mutex<HashMap<u32, oneshot::Sender<SftpResult<ResponsePacket>>>>,
    read_stream_pending: Mutex<VecDeque<PendingReadStreamEntry>>,
    next_id: AtomicU32,
    channel_control: Mutex<Option<SftpChannelControl>>,
}

struct SftpChannelControl {
    writer: Option<ChannelWriteHalf<Msg>>,
    lease: Option<SshChannelTransferGuard>,
}

impl SftpChannelControl {
    async fn close(mut self) {
        let writer = self.writer.take();
        let lease = self.lease.take();
        let cleanup = tokio::spawn(async move {
            if let Some(writer) = writer {
                let _ = writer.close().await;
            }
            drop(lease);
        });
        let _ = cleanup.await;
    }
}

impl Drop for SftpChannelControl {
    fn drop(&mut self) {
        let writer = self.writer.take();
        let lease = self.lease.take();
        if let (Some(writer), Ok(runtime)) = (writer, tokio::runtime::Handle::try_current()) {
            runtime.spawn(async move {
                let _ = writer.close().await;
                drop(lease);
            });
        }
    }
}

async fn close_sftp_channel(control: &mut Option<SftpChannelControl>) {
    if let Some(control) = control.take() {
        control.close().await;
    }
}

struct PendingReadStreamEntry {
    id: u32,
    offset: u64,
    tx: mpsc::UnboundedSender<SftpResult<(u64, ResponsePacket)>>,
}

#[derive(Debug)]
struct ResponsePacket {
    packet_type: u8,
    payload: Vec<u8>,
    payload_start: usize,
    response_id: Option<u32>,
    read_data: Option<SftpReadData>,
}

impl ResponsePacket {
    fn payload(&self) -> &[u8] {
        &self.payload[self.payload_start..]
    }

    fn split_response_id(&mut self) -> Option<u32> {
        if let Some(id) = self.response_id.take() {
            return Some(id);
        }
        if self.payload().len() < 4 {
            return None;
        }
        let id = u32::from_be_bytes(self.payload()[0..4].try_into().ok()?);
        self.payload_start += 4;
        Some(id)
    }

    fn into_read_data(self) -> SftpResult<SftpReadData> {
        if let Some(data) = self.read_data {
            return Ok(data);
        }
        payload_into_read_data(self.payload, self.payload_start)
    }

    #[cfg(test)]
    fn into_payload(self) -> Vec<u8> {
        if self.payload_start == 0 {
            self.payload
        } else {
            self.payload[self.payload_start..].to_vec()
        }
    }
}

impl FastSftpClient {
    pub async fn new(channel: SshChannelGuard) -> SftpResult<Self> {
        channel.request_subsystem(true, "sftp").await?;
        let (reader, writer, channel_guard) = channel
            .into_split()
            .ok_or_else(|| SftpError::Protocol("missing ssh channel".to_string()))?;
        Self::new_with_channel(reader, writer, Some(channel_guard)).await
    }

    pub async fn new_from_channel(channel: Channel<Msg>) -> SftpResult<Self> {
        channel.request_subsystem(true, "sftp").await?;
        let (reader, writer) = channel.split();
        Self::new_with_channel(reader, writer, None).await
    }

    async fn new_with_channel(
        reader: ChannelReadHalf,
        writer: ChannelWriteHalf<Msg>,
        channel_guard: Option<SshChannelTransferGuard>,
    ) -> SftpResult<Self> {
        let data_writer = writer.make_writer();
        Self::new_with_parts(
            SftpPacketReader::Channel(ChannelDataReader {
                channel: reader,
                current: None,
            }),
            Box::new(data_writer),
            Some(SftpChannelControl {
                writer: Some(writer),
                lease: channel_guard,
            }),
        )
        .await
    }

    #[cfg(test)]
    async fn new_with_stream(stream: Box<dyn AsyncReadWrite>) -> SftpResult<Self> {
        let (reader, writer) = tokio::io::split(stream);
        Self::new_with_parts(SftpPacketReader::Async(reader), Box::new(writer), None).await
    }

    async fn new_with_parts(
        mut reader: SftpPacketReader,
        mut writer: AsyncSftpWriter,
        mut channel_control: Option<SftpChannelControl>,
    ) -> SftpResult<Self> {
        if let Err(err) = write_raw_packet_to(&mut writer, SSH_FXP_INIT, &[0, 0, 0, 3]).await {
            close_sftp_channel(&mut channel_control).await;
            return Err(err);
        }
        let version_packet = match reader.read_packet().await {
            Ok(packet) => packet,
            Err(err) => {
                close_sftp_channel(&mut channel_control).await;
                return Err(err);
            }
        };
        if version_packet.packet_type != SSH_FXP_VERSION {
            close_sftp_channel(&mut channel_control).await;
            return Err(SftpError::UnexpectedPacket {
                expected: "VERSION",
                actual: version_packet.packet_type,
            });
        }

        let inner = Arc::new(FastSftpInner {
            writer: Mutex::new(writer),
            pending: Mutex::new(HashMap::new()),
            read_stream_pending: Mutex::new(VecDeque::new()),
            next_id: AtomicU32::new(1),
            channel_control: Mutex::new(channel_control),
        });

        let read_task = tokio::spawn(read_loop(reader, inner.clone()));
        Ok(Self {
            inner,
            read_task: Arc::new(Mutex::new(Some(read_task))),
        })
    }

    pub async fn read_dir<T: Into<String>>(&self, path: T) -> SftpResult<Vec<SftpDirEntry>> {
        let mut payload = Vec::new();
        put_string(&mut payload, path.into().as_bytes());
        let handle = self.open_handle_for(SSH_FXP_OPENDIR, payload).await?;
        let handle = Arc::<[u8]>::from(handle);
        let mut entries = Vec::new();

        loop {
            let mut payload = Vec::new();
            put_string(&mut payload, handle.as_ref());
            let response = self.request(SSH_FXP_READDIR, payload).await?;

            match response.packet_type {
                SSH_FXP_NAME => {
                    entries.extend(parse_name_entries(response.payload())?);
                }
                SSH_FXP_STATUS => {
                    let status = parse_status_packet(response.payload())?;
                    if status.code == SSH_FX_EOF {
                        break;
                    }
                    return Err(status.into());
                }
                packet_type => {
                    return Err(SftpError::UnexpectedPacket {
                        expected: "NAME",
                        actual: packet_type,
                    });
                }
            }
        }

        self.close_arc(handle).await?;
        Ok(entries)
    }

    pub async fn create_dir<T: Into<String>>(&self, path: T) -> SftpResult<()> {
        let mut payload = Vec::new();
        put_string(&mut payload, path.into().as_bytes());
        put_attrs(&mut payload, &SftpAttrs::empty());
        Ok(self.request_status(SSH_FXP_MKDIR, payload).await?)
    }

    pub async fn metadata<T: Into<String>>(&self, path: T) -> SftpResult<SftpAttrs> {
        let mut payload = Vec::new();
        put_string(&mut payload, path.into().as_bytes());
        let response = self.request(SSH_FXP_STAT, payload).await?;
        match response.packet_type {
            SSH_FXP_ATTRS => parse_attrs(response.payload()),
            SSH_FXP_STATUS => Err(parse_status_packet(response.payload())?.into()),
            actual => Err(SftpError::UnexpectedPacket {
                expected: "ATTRS",
                actual,
            }),
        }
    }

    pub async fn rename<O, N>(&self, oldpath: O, newpath: N) -> SftpResult<()>
    where
        O: Into<String>,
        N: Into<String>,
    {
        let mut payload = Vec::new();
        put_string(&mut payload, oldpath.into().as_bytes());
        put_string(&mut payload, newpath.into().as_bytes());
        Ok(self.request_status(SSH_FXP_RENAME, payload).await?)
    }

    pub async fn remove_file<T: Into<String>>(&self, path: T) -> SftpResult<()> {
        let mut payload = Vec::new();
        put_string(&mut payload, path.into().as_bytes());
        Ok(self.request_status(SSH_FXP_REMOVE, payload).await?)
    }

    pub async fn open<T: Into<String>>(&self, path: T) -> SftpResult<FastSftpFile> {
        self.open_with_flags(path, SftpOpenOptions::READ).await
    }

    pub async fn open_read_handle<T: Into<String>>(&self, path: T) -> SftpResult<Vec<u8>> {
        let mut payload = Vec::new();
        put_string(&mut payload, path.into().as_bytes());
        put_u32(&mut payload, SSH_FXF_READ);
        put_attrs(&mut payload, &SftpAttrs::empty());
        self.open_handle_for(SSH_FXP_OPEN, payload).await
    }

    pub async fn open_with_flags<T: Into<String>>(
        &self,
        path: T,
        flags: SftpOpenOptions,
    ) -> SftpResult<FastSftpFile> {
        let mut payload = Vec::new();
        put_string(&mut payload, path.into().as_bytes());
        put_u32(&mut payload, flags.bits());
        put_attrs(&mut payload, &SftpAttrs::empty());
        let handle = self.open_handle_for(SSH_FXP_OPEN, payload).await?;

        Ok(FastSftpFile {
            client: self.clone(),
            handle: Arc::from(handle),
            offset: 0,
        })
    }

    pub async fn open_upload(&self, path: &str, size: u64) -> SftpResult<Vec<u8>> {
        let mut payload = Vec::new();
        put_string(&mut payload, path.as_bytes());
        put_u32(&mut payload, SSH_FXF_WRITE | SSH_FXF_CREAT | SSH_FXF_TRUNC);
        put_size_attrs(&mut payload, size);

        self.open_handle_for(SSH_FXP_OPEN, payload).await
    }

    pub async fn open_upload_range(&self, path: &str) -> SftpResult<Vec<u8>> {
        let mut payload = Vec::new();
        put_string(&mut payload, path.as_bytes());
        put_u32(&mut payload, SSH_FXF_WRITE | SSH_FXF_CREAT);
        put_u32(&mut payload, 0);

        self.open_handle_for(SSH_FXP_OPEN, payload).await
    }

    async fn open_handle_for(&self, packet_type: u8, payload: Vec<u8>) -> SftpResult<Vec<u8>> {
        let response = self.request(packet_type, payload).await?;
        match response.packet_type {
            SSH_FXP_HANDLE => {
                let mut cursor = Cursor::new(response.payload());
                Ok(cursor.read_string()?.to_vec())
            }
            SSH_FXP_STATUS => Err(parse_status_packet(response.payload())?.into()),
            actual => Err(SftpError::UnexpectedPacket {
                expected: "HANDLE",
                actual,
            }),
        }
    }

    pub async fn set_size(&self, handle: &[u8], size: u64) -> SftpResult<()> {
        let mut payload = Vec::new();
        put_string(&mut payload, handle);
        put_size_attrs(&mut payload, size);
        self.request_status(SSH_FXP_FSETSTAT, payload).await
    }

    pub async fn write(&self, handle: Arc<[u8]>, offset: u64, data: Box<[u8]>) -> SftpResult<()> {
        self.begin_write(handle, offset, data).await?.wait().await
    }

    pub async fn begin_write(
        &self,
        handle: Arc<[u8]>,
        offset: u64,
        data: Box<[u8]>,
    ) -> SftpResult<PendingSftpWrite> {
        self.request_write(handle.as_ref(), offset, &data).await
    }

    pub async fn begin_read(
        &self,
        handle: Arc<[u8]>,
        offset: u64,
        len: usize,
    ) -> SftpResult<PendingSftpRead> {
        self.request_read(handle.as_ref(), offset, len).await
    }

    pub async fn begin_reads(
        &self,
        handle: Arc<[u8]>,
        requests: &[(u64, usize)],
    ) -> SftpResult<Vec<(u64, PendingSftpRead)>> {
        if requests.is_empty() {
            return Ok(Vec::new());
        }

        let ids = self.next_ids(requests.len());
        let mut pending_reads = Vec::with_capacity(requests.len());
        let mut pending_senders = Vec::with_capacity(requests.len());
        for (&id, &(offset, _)) in ids.iter().zip(requests) {
            let (tx, rx) = oneshot::channel();
            pending_senders.push((id, tx));
            pending_reads.push((offset, PendingSftpRead { rx }));
        }

        {
            let mut pending = self.inner.pending.lock().await;
            for (id, tx) in pending_senders {
                pending.insert(id, tx);
            }
        }

        let write_result =
            write_sftp_read_packets(&self.inner.writer, handle.as_ref(), &ids, requests).await;
        if let Err(err) = write_result {
            let mut pending = self.inner.pending.lock().await;
            for id in ids {
                pending.remove(&id);
            }
            return Err(err);
        }

        Ok(pending_reads)
    }

    pub fn read_stream(&self) -> SftpReadStream {
        let (tx, rx) = mpsc::unbounded_channel();
        SftpReadStream {
            client: self.clone(),
            tx,
            rx,
            ids: Vec::new(),
            request_packets: Vec::new(),
        }
    }

    pub async fn close(&self, handle: Vec<u8>) -> SftpResult<()> {
        let mut payload = Vec::new();
        put_string(&mut payload, &handle);
        self.request_status(SSH_FXP_CLOSE, payload).await
    }

    pub async fn shutdown(&self) {
        let _ = self.inner.writer.lock().await.shutdown().await;
        self.close_channel().await;
        self.abort_reader().await;
        fail_all_pending(self.inner.as_ref(), SftpError::Shutdown).await;
    }

    pub async fn abort(&self) {
        self.close_channel().await;
        self.abort_reader().await;
        fail_all_pending(self.inner.as_ref(), SftpError::Aborted).await;
    }

    async fn close_channel(&self) {
        let control = self.inner.channel_control.lock().await.take();
        if let Some(control) = control {
            control.close().await;
        }
    }

    async fn abort_reader(&self) {
        if let Some(task) = self.read_task.lock().await.take() {
            task.abort();
        }
    }

    async fn close_arc(&self, handle: Arc<[u8]>) -> SftpResult<()> {
        let mut payload = Vec::new();
        put_string(&mut payload, handle.as_ref());
        self.request_status(SSH_FXP_CLOSE, payload).await
    }

    async fn set_handle_metadata(&self, handle: &[u8], metadata: SftpAttrs) -> SftpResult<()> {
        let mut payload = Vec::new();
        put_string(&mut payload, handle);
        put_attrs(&mut payload, &metadata);
        self.request_status(SSH_FXP_FSETSTAT, payload).await
    }

    async fn read_at(&self, handle: &[u8], offset: u64, len: usize) -> SftpResult<Vec<u8>> {
        let mut payload = Vec::new();
        put_string(&mut payload, handle);
        put_u64(&mut payload, offset);
        put_u32(&mut payload, len as u32);

        let response = self.request(SSH_FXP_READ, payload).await?;
        match response.packet_type {
            SSH_FXP_DATA => payload_into_data(response),
            SSH_FXP_STATUS => {
                let status = parse_status_packet(response.payload())?;
                if status.code == SSH_FX_EOF {
                    Ok(Vec::new())
                } else {
                    Err(status.into())
                }
            }
            packet_type => Err(SftpError::UnexpectedPacket {
                expected: "DATA",
                actual: packet_type,
            }),
        }
    }

    async fn request_status(&self, packet_type: u8, payload: Vec<u8>) -> SftpResult<()> {
        let response = self.request(packet_type, payload).await?;
        if response.packet_type != SSH_FXP_STATUS {
            return Err(SftpError::UnexpectedPacket {
                expected: "STATUS",
                actual: response.packet_type,
            });
        }

        parse_status(response.payload())
    }

    async fn request(&self, packet_type: u8, payload: Vec<u8>) -> SftpResult<ResponsePacket> {
        self.request_pending(packet_type, payload)
            .await?
            .wait()
            .await
    }

    async fn request_pending(
        &self,
        packet_type: u8,
        mut payload: Vec<u8>,
    ) -> SftpResult<PendingSftpRequest> {
        let id = self.next_id();
        let (tx, rx) = oneshot::channel();
        self.inner.pending.lock().await.insert(id, tx);

        let mut body = Vec::with_capacity(payload.len() + 4);
        put_u32(&mut body, id);
        body.append(&mut payload);
        if let Err(err) = write_raw_packet(&self.inner.writer, packet_type, &body).await {
            self.inner.pending.lock().await.remove(&id);
            return Err(err);
        }

        Ok(PendingSftpRequest { rx })
    }

    async fn request_write(
        &self,
        handle: &[u8],
        offset: u64,
        data: &[u8],
    ) -> SftpResult<PendingSftpWrite> {
        let id = self.next_id();
        let (tx, rx) = oneshot::channel();
        self.inner.pending.lock().await.insert(id, tx);

        let write_result =
            write_sftp_write_packet(&self.inner.writer, id, handle, offset, data).await;
        if let Err(err) = write_result {
            self.inner.pending.lock().await.remove(&id);
            return Err(err);
        }

        Ok(PendingSftpWrite { rx })
    }

    async fn request_read(
        &self,
        handle: &[u8],
        offset: u64,
        len: usize,
    ) -> SftpResult<PendingSftpRead> {
        let id = self.next_id();
        let (tx, rx) = oneshot::channel();
        self.inner.pending.lock().await.insert(id, tx);

        let read_result = write_sftp_read_packet(&self.inner.writer, id, handle, offset, len).await;
        if let Err(err) = read_result {
            self.inner.pending.lock().await.remove(&id);
            return Err(err);
        }

        Ok(PendingSftpRead { rx })
    }

    fn next_id(&self) -> u32 {
        loop {
            let id = self
                .inner
                .next_id
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            if id != 0 {
                return id;
            }
        }
    }

    fn next_ids(&self, count: usize) -> Vec<u32> {
        let mut ids = Vec::with_capacity(count);
        self.next_ids_into(count, &mut ids);
        ids
    }

    fn next_ids_into(&self, count: usize, ids: &mut Vec<u32>) {
        ids.clear();
        ids.reserve(count);
        for _ in 0..count {
            ids.push(self.next_id());
        }
    }
}

impl SftpReadStream {
    pub async fn begin_reads(
        &mut self,
        handle: Arc<[u8]>,
        requests: &[(u64, usize)],
    ) -> SftpResult<usize> {
        if requests.is_empty() {
            return Ok(0);
        }

        self.client.next_ids_into(requests.len(), &mut self.ids);
        {
            let mut pending = self.client.inner.read_stream_pending.lock().await;
            for (&id, &(offset, _)) in self.ids.iter().zip(requests) {
                pending.push_back(PendingReadStreamEntry {
                    id,
                    offset,
                    tx: self.tx.clone(),
                });
            }
        }

        let write_result = write_sftp_read_packets_buffered(
            &self.client.inner.writer,
            handle.as_ref(),
            &self.ids,
            requests,
            &mut self.request_packets,
        )
        .await;
        if let Err(err) = write_result {
            remove_read_stream_pending(&self.client.inner, &self.ids).await;
            return Err(err);
        }

        Ok(requests.len())
    }

    pub async fn recv_data(&mut self) -> SftpResult<(u64, SftpReadData)> {
        let (offset, response) = self.rx.recv().await.ok_or(SftpError::ReadStreamClosed)??;
        let data = match response.packet_type {
            SSH_FXP_DATA => response.into_read_data(),
            SSH_FXP_STATUS => {
                let status = parse_status_packet(response.payload())?;
                if status.code == SSH_FX_EOF {
                    Ok(SftpReadData::empty())
                } else {
                    Err(status.into())
                }
            }
            packet_type => Err(SftpError::UnexpectedPacket {
                expected: "DATA",
                actual: packet_type,
            }),
        }?;

        Ok((offset, data))
    }
}

struct PendingSftpRequest {
    rx: oneshot::Receiver<SftpResult<ResponsePacket>>,
}

impl PendingSftpRequest {
    async fn wait(self) -> SftpResult<ResponsePacket> {
        self.rx
            .await
            .map_err(|_| SftpError::ResponseChannelClosed)?
    }
}

impl PendingSftpWrite {
    pub async fn wait(self) -> SftpResult<()> {
        let response = self
            .rx
            .await
            .map_err(|_| SftpError::ResponseChannelClosed)??;
        if response.packet_type != SSH_FXP_STATUS {
            return Err(SftpError::UnexpectedPacket {
                expected: "STATUS",
                actual: response.packet_type,
            });
        }

        parse_status(response.payload())
    }
}

impl PendingSftpRead {
    pub async fn wait(self) -> SftpResult<Vec<u8>> {
        self.wait_data().await.map(SftpReadData::into_vec)
    }

    pub async fn wait_data(self) -> SftpResult<SftpReadData> {
        let response = self
            .rx
            .await
            .map_err(|_| SftpError::ResponseChannelClosed)??;
        match response.packet_type {
            SSH_FXP_DATA => response.into_read_data(),
            SSH_FXP_STATUS => {
                let status = parse_status_packet(response.payload())?;
                if status.code == SSH_FX_EOF {
                    Ok(SftpReadData::empty())
                } else {
                    Err(status.into())
                }
            }
            packet_type => Err(SftpError::UnexpectedPacket {
                expected: "DATA",
                actual: packet_type,
            }),
        }
    }
}

async fn read_loop(mut reader: SftpPacketReader, inner: Arc<FastSftpInner>) {
    loop {
        let packet = reader.read_packet().await;
        let packet = match packet {
            Ok(packet) => packet,
            Err(err) => {
                fail_all_pending(&inner, err).await;
                break;
            }
        };

        let mut packet = packet;
        let Some(id) = packet.split_response_id() else {
            fail_all_pending(
                &inner,
                SftpError::Protocol("sftp response missing id".to_string()),
            )
            .await;
            break;
        };

        if let Some(entry) = remove_read_stream_entry(&inner, id).await {
            let _ = entry.tx.send(Ok((entry.offset, packet)));
        } else if let Some(tx) = inner.pending.lock().await.remove(&id) {
            let _ = tx.send(Ok(packet));
        }
    }
}

impl SftpPacketReader {
    async fn read_packet(&mut self) -> SftpResult<ResponsePacket> {
        match self {
            #[cfg(test)]
            Self::Async(reader) => read_packet(reader).await,
            Self::Channel(reader) => reader.read_packet().await,
        }
    }
}

impl ChannelDataReader {
    async fn read_packet(&mut self) -> SftpResult<ResponsePacket> {
        let mut len = [0u8; 4];
        self.read_exact(&mut len).await?;
        let len = u32::from_be_bytes(len) as usize;
        if len == 0 {
            return Err(SftpError::Protocol("empty sftp packet".to_string()));
        }

        let mut packet_type = [0u8; 1];
        self.read_exact(&mut packet_type).await?;
        let packet_type = packet_type[0];
        if packet_type == SSH_FXP_DATA {
            if len < 9 {
                return Err(SftpError::Protocol("invalid sftp data packet".to_string()));
            }

            let mut header = [0u8; 8];
            self.read_exact(&mut header).await?;
            let response_id = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
            let data_len =
                u32::from_be_bytes([header[4], header[5], header[6], header[7]]) as usize;
            if len != 9 + data_len {
                return Err(SftpError::Protocol(format!(
                    "invalid sftp data length: packet={len}, data={data_len}"
                )));
            }

            return Ok(ResponsePacket {
                packet_type,
                payload: Vec::new(),
                payload_start: 0,
                response_id: Some(response_id),
                read_data: Some(SftpReadData {
                    payload: SftpReadPayload::Segmented(self.read_segments(data_len).await?),
                    data_len,
                }),
            });
        }

        let mut payload = Vec::with_capacity(len);
        payload.push(packet_type);
        while payload.len() < len {
            self.copy_into_vec(&mut payload, len).await?;
        }
        Ok(ResponsePacket {
            packet_type,
            payload,
            payload_start: 1,
            response_id: None,
            read_data: None,
        })
    }

    async fn read_segments(&mut self, len: usize) -> SftpResult<SmallVec<[Bytes; 4]>> {
        let mut remaining = len;
        let mut segments = SmallVec::new();
        while remaining > 0 {
            self.ensure_data().await?;
            let current = self
                .current
                .take()
                .ok_or_else(|| SftpError::Protocol("missing sftp channel data".to_string()))?;
            let available = current.data.len() - current.offset;
            let segment_len = remaining.min(available);
            let next_offset = current.offset + segment_len;
            segments.push(current.data.slice(current.offset..next_offset));
            if segment_len < available {
                self.current = Some(ChannelDataBuffer {
                    data: current.data,
                    offset: next_offset,
                });
            }
            remaining -= segment_len;
        }
        Ok(segments)
    }

    async fn read_exact(&mut self, buffer: &mut [u8]) -> SftpResult<()> {
        let mut filled = 0usize;
        while filled < buffer.len() {
            self.ensure_data().await?;
            let current = self
                .current
                .as_mut()
                .ok_or_else(|| SftpError::Protocol("missing sftp channel data".to_string()))?;
            let data = current.data.as_ref();
            let copied = (buffer.len() - filled).min(data.len() - current.offset);
            buffer[filled..filled + copied]
                .copy_from_slice(&data[current.offset..current.offset + copied]);
            filled += copied;
            current.offset += copied;
            if current.offset == data.len() {
                self.current = None;
            }
        }
        Ok(())
    }

    async fn copy_into_vec(&mut self, buffer: &mut Vec<u8>, target_len: usize) -> SftpResult<()> {
        self.ensure_data().await?;
        let current = self
            .current
            .as_mut()
            .ok_or_else(|| SftpError::Protocol("missing sftp channel data".to_string()))?;
        let data = current.data.as_ref();
        let copied = (target_len - buffer.len()).min(data.len() - current.offset);
        buffer.extend_from_slice(&data[current.offset..current.offset + copied]);
        current.offset += copied;
        if current.offset == data.len() {
            self.current = None;
        }
        Ok(())
    }

    async fn ensure_data(&mut self) -> SftpResult<()> {
        while self.current.is_none() {
            match self.channel.wait().await {
                Some(ChannelMsg::Data { data }) if !data.is_empty() => {
                    self.current = Some(ChannelDataBuffer { data, offset: 0 });
                }
                Some(ChannelMsg::Eof | ChannelMsg::Close) | None => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        "early eof while reading sftp packet",
                    )
                    .into());
                }
                Some(_) => {}
            }
        }
        Ok(())
    }
}

async fn remove_read_stream_entry(
    inner: &FastSftpInner,
    id: u32,
) -> Option<PendingReadStreamEntry> {
    let mut pending = inner.read_stream_pending.lock().await;
    if pending.front().is_some_and(|entry| entry.id == id) {
        return pending.pop_front();
    }
    let index = pending.iter().position(|entry| entry.id == id)?;
    pending.remove(index)
}

async fn remove_read_stream_pending(inner: &FastSftpInner, ids: &[u32]) {
    let mut pending = inner.read_stream_pending.lock().await;
    pending.retain(|entry| !ids.contains(&entry.id));
}

async fn fail_all_pending(inner: &FastSftpInner, err: SftpError) {
    let mut pending = inner.pending.lock().await;
    for (_, tx) in std::mem::take(&mut *pending) {
        let _ = tx.send(Err(err.clone()));
    }
    drop(pending);

    let mut read_stream_pending = inner.read_stream_pending.lock().await;
    for entry in std::mem::take(&mut *read_stream_pending) {
        let _ = entry.tx.send(Err(err.clone()));
    }
}

async fn write_raw_packet<W>(writer: &Mutex<W>, packet_type: u8, payload: &[u8]) -> SftpResult<()>
where
    W: AsyncWrite + Unpin,
{
    let len = payload.len() + 1;
    if len > u32::MAX as usize {
        return Err(SftpError::Protocol("sftp packet too large".to_string()));
    }

    let mut writer = writer.lock().await;
    write_raw_packet_to(&mut *writer, packet_type, payload).await
}

async fn write_sftp_write_packet<W>(
    writer: &Mutex<W>,
    id: u32,
    handle: &[u8],
    offset: u64,
    data: &[u8],
) -> SftpResult<()>
where
    W: AsyncWrite + Unpin,
{
    let payload_len = 4 + 4 + handle.len() + 8 + 4 + data.len();
    let len = payload_len + 1;
    if len > u32::MAX as usize {
        return Err(SftpError::Protocol("sftp packet too large".to_string()));
    }

    let mut header = Vec::with_capacity(4 + 1 + 4 + 4 + handle.len() + 8 + 4);
    put_u32(&mut header, len as u32);
    header.push(SSH_FXP_WRITE);
    put_u32(&mut header, id);
    put_string(&mut header, handle);
    put_u64(&mut header, offset);
    put_u32(&mut header, data.len() as u32);

    let mut writer = writer.lock().await;
    writer.write_all(&header).await?;
    writer.write_all(data).await?;
    Ok(())
}

async fn write_sftp_read_packet<W>(
    writer: &Mutex<W>,
    id: u32,
    handle: &[u8],
    offset: u64,
    data_len: usize,
) -> SftpResult<()>
where
    W: AsyncWrite + Unpin,
{
    let payload_len = 4 + 4 + handle.len() + 8 + 4;
    let len = payload_len + 1;
    if len > u32::MAX as usize {
        return Err(SftpError::Protocol("sftp packet too large".to_string()));
    }

    let mut packet = Vec::with_capacity(4 + len);
    put_u32(&mut packet, len as u32);
    packet.push(SSH_FXP_READ);
    put_u32(&mut packet, id);
    put_string(&mut packet, handle);
    put_u64(&mut packet, offset);
    put_u32(&mut packet, data_len as u32);

    let mut writer = writer.lock().await;
    writer.write_all(&packet).await?;
    Ok(())
}

async fn write_sftp_read_packets<W>(
    writer: &Mutex<W>,
    handle: &[u8],
    ids: &[u32],
    requests: &[(u64, usize)],
) -> SftpResult<()>
where
    W: AsyncWrite + Unpin,
{
    let mut packets = Vec::new();
    write_sftp_read_packets_buffered(writer, handle, ids, requests, &mut packets).await
}

async fn write_sftp_read_packets_buffered<W>(
    writer: &Mutex<W>,
    handle: &[u8],
    ids: &[u32],
    requests: &[(u64, usize)],
    packets: &mut Vec<u8>,
) -> SftpResult<()>
where
    W: AsyncWrite + Unpin,
{
    let packet_len = 4 + 1 + 4 + 4 + handle.len() + 8 + 4;
    packets.clear();
    packets.reserve(packet_len * requests.len());
    for (&id, &(offset, data_len)) in ids.iter().zip(requests) {
        let payload_len = 4 + 4 + handle.len() + 8 + 4;
        let len = payload_len + 1;
        if len > u32::MAX as usize {
            return Err(SftpError::Protocol("sftp packet too large".to_string()));
        }

        put_u32(packets, len as u32);
        packets.push(SSH_FXP_READ);
        put_u32(packets, id);
        put_string(packets, handle);
        put_u64(packets, offset);
        put_u32(packets, data_len as u32);
    }

    let mut writer = writer.lock().await;
    writer.write_all(packets).await?;
    Ok(())
}

async fn write_raw_packet_to<W>(writer: &mut W, packet_type: u8, payload: &[u8]) -> SftpResult<()>
where
    W: AsyncWrite + Unpin,
{
    let len = payload.len() + 1;
    if len > u32::MAX as usize {
        return Err(SftpError::Protocol("sftp packet too large".to_string()));
    }

    let mut packet = Vec::with_capacity(4 + len);
    put_u32(&mut packet, len as u32);
    packet.push(packet_type);
    packet.extend_from_slice(payload);
    writer.write_all(&packet).await?;
    Ok(())
}

#[cfg(test)]
async fn read_packet<R>(reader: &mut R) -> SftpResult<ResponsePacket>
where
    R: AsyncRead + Unpin,
{
    let len = reader.read_u32().await? as usize;
    if len == 0 {
        return Err(SftpError::Protocol("empty sftp packet".to_string()));
    }
    let payload = read_exact_vec(reader, len).await?;
    let packet_type = payload[0];
    Ok(ResponsePacket {
        packet_type,
        payload,
        payload_start: 1,
        response_id: None,
        read_data: None,
    })
}

#[cfg(test)]
async fn read_exact_vec<R>(reader: &mut R, len: usize) -> SftpResult<Vec<u8>>
where
    R: AsyncRead + Unpin,
{
    let mut buffer = Vec::with_capacity(len);
    while buffer.len() < len {
        let read = reader.read_buf(&mut buffer).await?;
        if read == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "early eof while reading sftp packet",
            )
            .into());
        }
    }
    Ok(buffer)
}

#[cfg(test)]
fn split_response_id(mut payload: Vec<u8>) -> Option<(u32, Vec<u8>)> {
    if payload.len() < 4 {
        return None;
    }
    let id = u32::from_be_bytes(payload[0..4].try_into().ok()?);
    let payload = payload.split_off(4);
    Some((id, payload))
}

fn payload_into_data(packet: ResponsePacket) -> SftpResult<Vec<u8>> {
    packet.into_read_data().map(SftpReadData::into_vec)
}

fn payload_into_read_data(payload: Vec<u8>, payload_start: usize) -> SftpResult<SftpReadData> {
    if payload.len() < payload_start + 4 {
        return Err(SftpError::Protocol(
            "unexpected end of sftp packet".to_string(),
        ));
    }
    let len = u32::from_be_bytes(
        payload[payload_start..payload_start + 4]
            .try_into()
            .map_err(|_| SftpError::Protocol("invalid data length".to_string()))?,
    ) as usize;
    let data_start = payload_start + 4;
    if payload.len() - data_start < len {
        return Err(SftpError::Protocol(
            "unexpected end of sftp string".to_string(),
        ));
    }
    Ok(SftpReadData {
        payload: SftpReadPayload::Contiguous {
            payload,
            data_start,
        },
        data_len: len,
    })
}

struct SftpStatus {
    code: u32,
    message: String,
}

impl From<SftpStatus> for SftpError {
    fn from(status: SftpStatus) -> Self {
        Self::Status {
            code: status.code,
            message: status.message,
        }
    }
}

fn parse_status(payload: &[u8]) -> SftpResult<()> {
    let status = parse_status_packet(payload)?;
    if status.code == SSH_FX_OK {
        return Ok(());
    }

    Err(status.into())
}

fn parse_status_packet(payload: &[u8]) -> SftpResult<SftpStatus> {
    let mut cursor = Cursor::new(payload);
    let code = cursor.read_u32()?;
    let message = cursor
        .read_string()
        .map(|bytes| String::from_utf8_lossy(bytes).to_string())
        .unwrap_or_else(|_| format!("status code {code}"));
    Ok(SftpStatus { code, message })
}

fn parse_name_entries(payload: &[u8]) -> SftpResult<Vec<SftpDirEntry>> {
    let mut cursor = Cursor::new(payload);
    let count = cursor.read_u32()? as usize;
    let mut entries = Vec::with_capacity(count);

    for _ in 0..count {
        let name = String::from_utf8_lossy(cursor.read_string()?).to_string();
        let _long_name = cursor.read_string()?;
        let attrs = cursor.read_attrs()?;
        if name != "." && name != ".." {
            entries.push(SftpDirEntry { name, attrs });
        }
    }

    Ok(entries)
}

fn parse_attrs(payload: &[u8]) -> SftpResult<SftpAttrs> {
    Cursor::new(payload).read_attrs()
}

fn put_attrs(buf: &mut Vec<u8>, attrs: &SftpAttrs) {
    let mut flags = 0u32;
    if attrs.size.is_some() {
        flags |= SSH_FILEXFER_ATTR_SIZE;
    }
    if attrs.uid.is_some() || attrs.gid.is_some() {
        flags |= SSH_FILEXFER_ATTR_UIDGID;
    }
    if attrs.permissions.is_some() {
        flags |= SSH_FILEXFER_ATTR_PERMISSIONS;
    }
    if attrs.atime.is_some() || attrs.mtime.is_some() {
        flags |= SSH_FILEXFER_ATTR_ACMODTIME;
    }

    put_u32(buf, flags);
    if let Some(size) = attrs.size {
        put_u64(buf, size);
    }
    if flags & SSH_FILEXFER_ATTR_UIDGID != 0 {
        put_u32(buf, attrs.uid.unwrap_or_default());
        put_u32(buf, attrs.gid.unwrap_or_default());
    }
    if let Some(permissions) = attrs.permissions {
        put_u32(buf, permissions);
    }
    if flags & SSH_FILEXFER_ATTR_ACMODTIME != 0 {
        put_u32(buf, attrs.atime.unwrap_or_default());
        put_u32(buf, attrs.mtime.unwrap_or_default());
    }
}

fn put_size_attrs(buf: &mut Vec<u8>, size: u64) {
    put_u32(buf, SSH_FILEXFER_ATTR_SIZE);
    put_u64(buf, size);
}

fn put_string(buf: &mut Vec<u8>, value: &[u8]) {
    put_u32(buf, value.len() as u32);
    buf.extend_from_slice(value);
}

fn put_u32(buf: &mut Vec<u8>, value: u32) {
    buf.extend_from_slice(&value.to_be_bytes());
}

fn put_u64(buf: &mut Vec<u8>, value: u64) {
    buf.extend_from_slice(&value.to_be_bytes());
}

struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn read_u32(&mut self) -> SftpResult<u32> {
        if self.offset + 4 > self.bytes.len() {
            return Err(SftpError::Protocol(
                "unexpected end of sftp packet".to_string(),
            ));
        }
        let value = u32::from_be_bytes(
            self.bytes[self.offset..self.offset + 4]
                .try_into()
                .map_err(|_| SftpError::Protocol("invalid u32".to_string()))?,
        );
        self.offset += 4;
        Ok(value)
    }

    fn read_u64(&mut self) -> SftpResult<u64> {
        if self.offset + 8 > self.bytes.len() {
            return Err(SftpError::Protocol(
                "unexpected end of sftp packet".to_string(),
            ));
        }
        let value = u64::from_be_bytes(
            self.bytes[self.offset..self.offset + 8]
                .try_into()
                .map_err(|_| SftpError::Protocol("invalid u64".to_string()))?,
        );
        self.offset += 8;
        Ok(value)
    }

    fn read_string(&mut self) -> SftpResult<&'a [u8]> {
        let len = self.read_u32()? as usize;
        if self.offset + len > self.bytes.len() {
            return Err(SftpError::Protocol(
                "unexpected end of sftp string".to_string(),
            ));
        }
        let value = &self.bytes[self.offset..self.offset + len];
        self.offset += len;
        Ok(value)
    }

    fn read_attrs(&mut self) -> SftpResult<SftpAttrs> {
        let flags = self.read_u32()?;
        let size = if flags & SSH_FILEXFER_ATTR_SIZE != 0 {
            Some(self.read_u64()?)
        } else {
            None
        };
        let (uid, gid) = if flags & SSH_FILEXFER_ATTR_UIDGID != 0 {
            (Some(self.read_u32()?), Some(self.read_u32()?))
        } else {
            (None, None)
        };
        let permissions = if flags & SSH_FILEXFER_ATTR_PERMISSIONS != 0 {
            Some(self.read_u32()?)
        } else {
            None
        };
        let (atime, mtime) = if flags & SSH_FILEXFER_ATTR_ACMODTIME != 0 {
            (Some(self.read_u32()?), Some(self.read_u32()?))
        } else {
            (None, None)
        };

        if flags & SSH_FILEXFER_ATTR_EXTENDED != 0 {
            let extended_count = self.read_u32()?;
            for _ in 0..extended_count {
                let _extension_type = self.read_string()?;
                let _extension_data = self.read_string()?;
            }
        }

        Ok(SftpAttrs {
            size,
            uid,
            user: None,
            gid,
            group: None,
            permissions,
            atime,
            mtime,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::error::Error as _;

    use tokio::io::duplex;

    use super::*;

    #[derive(Debug)]
    struct TestSource;

    impl std::fmt::Display for TestSource {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("test source")
        }
    }

    impl std::error::Error for TestSource {}

    #[test]
    fn attrs_detect_file_type_from_unix_mode() {
        let mut attrs = SftpAttrs::empty();

        attrs.permissions = Some(S_IFDIR | 0o755);
        assert_eq!(attrs.file_type(), SftpFileType::Dir);

        attrs.permissions = Some(S_IFREG | 0o644);
        assert_eq!(attrs.file_type(), SftpFileType::File);

        attrs.permissions = Some(S_IFLNK | 0o777);
        assert_eq!(attrs.file_type(), SftpFileType::Symlink);
    }

    #[test]
    fn attrs_formats_permissions_without_file_type_bits() {
        let attrs = SftpAttrs {
            permissions: Some(S_IFREG | 0o754),
            ..SftpAttrs::empty()
        };

        assert_eq!(attrs.permissions_string(), "rwxr-xr--");
    }

    #[test]
    fn open_options_convert_to_sftp_wire_bits() {
        let flags = SftpOpenOptions::READ
            | SftpOpenOptions::WRITE
            | SftpOpenOptions::CREATE
            | SftpOpenOptions::TRUNCATE;

        assert_eq!(
            flags.bits(),
            SSH_FXF_READ | SSH_FXF_WRITE | SSH_FXF_CREAT | SSH_FXF_TRUNC
        );
    }

    #[test]
    fn attrs_round_trip_through_sftp_wire_format() {
        let attrs = SftpAttrs {
            size: Some(1024),
            uid: Some(501),
            gid: Some(20),
            permissions: Some(S_IFREG | 0o640),
            atime: Some(11),
            mtime: Some(12),
            user: None,
            group: None,
        };
        let mut payload = Vec::new();

        put_attrs(&mut payload, &attrs);
        let parsed = parse_attrs(&payload).expect("attrs");

        assert_eq!(parsed.size, attrs.size);
        assert_eq!(parsed.uid, attrs.uid);
        assert_eq!(parsed.gid, attrs.gid);
        assert_eq!(parsed.permissions, attrs.permissions);
        assert_eq!(parsed.atime, attrs.atime);
        assert_eq!(parsed.mtime, attrs.mtime);
    }

    #[test]
    fn parse_name_entries_skips_current_and_parent_dirs() {
        let mut payload = Vec::new();
        put_u32(&mut payload, 3);
        put_string(&mut payload, b".");
        put_string(&mut payload, b".");
        put_attrs(&mut payload, &SftpAttrs::empty());
        put_string(&mut payload, b"..");
        put_string(&mut payload, b"..");
        put_attrs(&mut payload, &SftpAttrs::empty());
        put_string(&mut payload, b"file.txt");
        put_string(
            &mut payload,
            b"-rw-r--r-- 1 user group 0 Jan 1 00:00 file.txt",
        );
        put_attrs(
            &mut payload,
            &SftpAttrs {
                permissions: Some(S_IFREG | 0o644),
                ..SftpAttrs::empty()
            },
        );

        let entries = parse_name_entries(&payload).expect("name entries");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].file_name(), "file.txt");
        assert_eq!(entries[0].attrs.file_type(), SftpFileType::File);
    }

    #[test]
    fn split_response_id_removes_request_id_prefix() {
        let payload = vec![0, 0, 0, 42, b'o', b'k'];

        let (id, rest) = split_response_id(payload).expect("response id");

        assert_eq!(id, 42);
        assert_eq!(rest, b"ok");
    }

    #[test]
    fn parse_status_accepts_ok_and_preserves_status_details() {
        parse_status(&0u32.to_be_bytes()).expect("ok status");

        let mut payload = Vec::new();
        put_u32(&mut payload, 4);
        put_string(&mut payload, b"failure");

        let err = parse_status(&payload).expect_err("error status");
        match err {
            SftpError::Status { code, message } => {
                assert_eq!(code, 4);
                assert_eq!(message, "failure");
            }
            other => panic!("expected status error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn fail_all_pending_preserves_error_type_and_source() {
        let (writer, _reader) = duplex(64);
        let inner = FastSftpInner {
            writer: Mutex::new(Box::new(writer) as AsyncSftpWriter),
            pending: Mutex::new(HashMap::new()),
            read_stream_pending: Mutex::new(VecDeque::new()),
            next_id: AtomicU32::new(1),
            channel_control: Mutex::new(None),
        };
        let (first_tx, first_rx) = oneshot::channel();
        let (second_tx, second_rx) = oneshot::channel();
        inner.pending.lock().await.insert(1, first_tx);
        inner.pending.lock().await.insert(2, second_tx);

        let (stream_tx, mut stream_rx) = mpsc::unbounded_channel();
        inner
            .read_stream_pending
            .lock()
            .await
            .push_back(PendingReadStreamEntry {
                id: 3,
                offset: 0,
                tx: stream_tx,
            });

        let io_error = Arc::new(std::io::Error::new(
            std::io::ErrorKind::BrokenPipe,
            TestSource,
        ));
        fail_all_pending(&inner, SftpError::Io(Arc::clone(&io_error))).await;

        let first = first_rx
            .await
            .expect("first response")
            .expect_err("first error");
        let second = second_rx
            .await
            .expect("second response")
            .expect_err("second error");
        let stream = stream_rx
            .recv()
            .await
            .expect("stream response")
            .expect_err("stream error");

        for err in [first, second, stream] {
            match &err {
                SftpError::Io(source) => assert!(Arc::ptr_eq(source, &io_error)),
                other => panic!("expected io error, got {other:?}"),
            }
            let source = err.source().expect("sftp error source");
            let source = source
                .downcast_ref::<std::io::Error>()
                .expect("io error source");
            assert_eq!(source.kind(), std::io::ErrorKind::BrokenPipe);
            assert!(
                source
                    .get_ref()
                    .is_some_and(|source| source.is::<TestSource>())
            );
        }
    }

    #[tokio::test]
    async fn write_sftp_write_packet_serializes_without_payload_copy_format_regression() {
        let (client, mut server) = duplex(1024);
        let writer = Mutex::new(client);
        let handle = b"h1";
        let data = b"abc";

        write_sftp_write_packet(&writer, 7, handle, 9, data)
            .await
            .expect("write packet");

        let packet_len = 1 + 4 + 4 + handle.len() + 8 + 4 + data.len();
        let mut packet = vec![0; 4 + packet_len];
        server
            .read_exact(&mut packet)
            .await
            .expect("serialized packet");

        let mut expected = Vec::new();
        put_u32(&mut expected, packet_len as u32);
        expected.push(SSH_FXP_WRITE);
        put_u32(&mut expected, 7);
        put_string(&mut expected, handle);
        put_u64(&mut expected, 9);
        put_string(&mut expected, data);

        assert_eq!(packet, expected);
    }

    #[tokio::test]
    async fn read_packet_decodes_length_prefixed_sftp_packet() {
        let (mut client, mut server) = duplex(1024);
        let payload = b"payload";

        tokio::spawn(async move {
            write_raw_packet_to(&mut client, SSH_FXP_STATUS, payload)
                .await
                .expect("write packet");
        });

        let packet = read_packet(&mut server).await.expect("read packet");

        assert_eq!(packet.packet_type, SSH_FXP_STATUS);
        assert_eq!(packet.payload(), payload);
    }

    #[tokio::test]
    async fn fast_client_upload_flow_works_over_async_stream() {
        let (client_stream, mut server_stream) = duplex(8192);
        let server = tokio::spawn(async move {
            let init = read_packet(&mut server_stream).await.expect("init packet");
            assert_eq!(init.packet_type, SSH_FXP_INIT);
            write_raw_packet_to(&mut server_stream, SSH_FXP_VERSION, &3u32.to_be_bytes())
                .await
                .expect("version response");

            let open = read_packet(&mut server_stream).await.expect("open packet");
            assert_eq!(open.packet_type, SSH_FXP_OPEN);
            let (id, payload) = split_response_id(open.into_payload()).expect("open id");
            let mut cursor = Cursor::new(&payload);
            assert_eq!(cursor.read_string().expect("path"), b"/tmp/file.bin");
            assert_eq!(
                cursor.read_u32().expect("flags"),
                SSH_FXF_WRITE | SSH_FXF_CREAT | SSH_FXF_TRUNC
            );
            assert_eq!(cursor.read_attrs().expect("attrs").size, Some(3));

            let mut handle_response = Vec::new();
            put_u32(&mut handle_response, id);
            put_string(&mut handle_response, b"handle-1");
            write_raw_packet_to(&mut server_stream, SSH_FXP_HANDLE, &handle_response)
                .await
                .expect("handle response");

            let setstat = read_packet(&mut server_stream)
                .await
                .expect("setstat packet");
            assert_eq!(setstat.packet_type, SSH_FXP_FSETSTAT);
            respond_status_ok(&mut server_stream, setstat.into_payload()).await;

            let write = read_packet(&mut server_stream).await.expect("write packet");
            assert_eq!(write.packet_type, SSH_FXP_WRITE);
            let write_id = inspect_write_request(write.into_payload());
            respond_status_ok_with_id(&mut server_stream, write_id).await;

            let close = read_packet(&mut server_stream).await.expect("close packet");
            assert_eq!(close.packet_type, SSH_FXP_CLOSE);
            respond_status_ok(&mut server_stream, close.into_payload()).await;
        });

        let client = FastSftpClient::new_with_stream(Box::new(client_stream))
            .await
            .expect("client");
        let handle = client
            .open_upload("/tmp/file.bin", 3)
            .await
            .expect("open upload");
        client.set_size(&handle, 3).await.expect("set size");
        client
            .write(Arc::from(handle.clone()), 0, Box::from(*b"abc"))
            .await
            .expect("write");
        client.close(handle).await.expect("close");

        server.await.expect("server task");
    }

    #[tokio::test]
    async fn fast_client_read_flow_works_over_async_stream() {
        let (client_stream, mut server_stream) = duplex(8192);
        let server = tokio::spawn(async move {
            let init = read_packet(&mut server_stream).await.expect("init packet");
            assert_eq!(init.packet_type, SSH_FXP_INIT);
            write_raw_packet_to(&mut server_stream, SSH_FXP_VERSION, &3u32.to_be_bytes())
                .await
                .expect("version response");

            let open = read_packet(&mut server_stream).await.expect("open packet");
            assert_eq!(open.packet_type, SSH_FXP_OPEN);
            let (id, payload) = split_response_id(open.into_payload()).expect("open id");
            let mut cursor = Cursor::new(&payload);
            assert_eq!(cursor.read_string().expect("path"), b"/tmp/file.bin");
            assert_eq!(cursor.read_u32().expect("flags"), SSH_FXF_READ);

            let mut handle_response = Vec::new();
            put_u32(&mut handle_response, id);
            put_string(&mut handle_response, b"handle-1");
            write_raw_packet_to(&mut server_stream, SSH_FXP_HANDLE, &handle_response)
                .await
                .expect("handle response");

            let read = read_packet(&mut server_stream).await.expect("read packet");
            assert_eq!(read.packet_type, SSH_FXP_READ);
            let read_id = inspect_read_request(read.into_payload());
            let mut data_response = Vec::new();
            put_u32(&mut data_response, read_id);
            put_string(&mut data_response, b"abc");
            write_raw_packet_to(&mut server_stream, SSH_FXP_DATA, &data_response)
                .await
                .expect("data response");

            let close = read_packet(&mut server_stream).await.expect("close packet");
            assert_eq!(close.packet_type, SSH_FXP_CLOSE);
            respond_status_ok(&mut server_stream, close.into_payload()).await;
        });

        let client = FastSftpClient::new_with_stream(Box::new(client_stream))
            .await
            .expect("client");
        let handle = client
            .open_read_handle("/tmp/file.bin")
            .await
            .expect("open read");
        let data = client
            .begin_read(Arc::from(handle.clone()), 0, 3)
            .await
            .expect("begin read")
            .wait()
            .await
            .expect("read");
        assert_eq!(data, b"abc");
        client.close(handle).await.expect("close");

        server.await.expect("server task");
    }

    #[tokio::test]
    async fn open_handle_preserves_sftp_status_error() {
        let (client_stream, mut server_stream) = duplex(8192);
        let server = tokio::spawn(async move {
            let init = read_packet(&mut server_stream).await.expect("init packet");
            assert_eq!(init.packet_type, SSH_FXP_INIT);
            write_raw_packet_to(&mut server_stream, SSH_FXP_VERSION, &3u32.to_be_bytes())
                .await
                .expect("version response");

            let open = read_packet(&mut server_stream).await.expect("open packet");
            assert_eq!(open.packet_type, SSH_FXP_OPEN);
            let (id, _) = split_response_id(open.into_payload()).expect("open id");

            let mut status = Vec::new();
            put_u32(&mut status, id);
            put_u32(&mut status, 2);
            put_string(&mut status, b"no such file");
            put_string(&mut status, b"");
            write_raw_packet_to(&mut server_stream, SSH_FXP_STATUS, &status)
                .await
                .expect("status response");
        });

        let client = FastSftpClient::new_with_stream(Box::new(client_stream))
            .await
            .expect("client");
        let err = client
            .open_read_handle("/missing")
            .await
            .expect_err("open error");
        match err {
            SftpError::Status { code, message } => {
                assert_eq!(code, 2);
                assert_eq!(message, "no such file");
            }
            other => panic!("expected status error, got {other:?}"),
        }

        server.await.expect("server task");
    }

    async fn respond_status_ok<W>(writer: &mut W, request_payload: Vec<u8>)
    where
        W: AsyncWrite + Unpin,
    {
        let (id, _) = split_response_id(request_payload).expect("request id");
        respond_status_ok_with_id(writer, id).await;
    }

    async fn respond_status_ok_with_id<W>(writer: &mut W, id: u32)
    where
        W: AsyncWrite + Unpin,
    {
        let mut payload = Vec::new();
        put_u32(&mut payload, id);
        put_u32(&mut payload, SSH_FX_OK);
        put_string(&mut payload, b"ok");
        put_string(&mut payload, b"");
        write_raw_packet_to(writer, SSH_FXP_STATUS, &payload)
            .await
            .expect("status response");
    }

    fn inspect_write_request(payload: Vec<u8>) -> u32 {
        let (id, payload) = split_response_id(payload).expect("write id");
        let mut cursor = Cursor::new(&payload);
        assert_eq!(cursor.read_string().expect("handle"), b"handle-1");
        assert_eq!(cursor.read_u64().expect("offset"), 0);
        assert_eq!(cursor.read_string().expect("data"), b"abc");
        id
    }

    fn inspect_read_request(payload: Vec<u8>) -> u32 {
        let (id, payload) = split_response_id(payload).expect("read id");
        let mut cursor = Cursor::new(&payload);
        assert_eq!(cursor.read_string().expect("handle"), b"handle-1");
        assert_eq!(cursor.read_u64().expect("offset"), 0);
        assert_eq!(cursor.read_u32().expect("len"), 3);
        id
    }
}
