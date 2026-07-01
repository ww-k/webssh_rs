use std::{collections::BTreeMap, io::SeekFrom, ops::BitOr, sync::Arc};

use russh::{Channel, client::Msg};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    sync::{Mutex, oneshot},
    task::JoinHandle,
};

use crate::{
    apis::ApiErr, consts::services_err_code::ERR_CODE_SSH_ERR, map_ssh_err,
    ssh_session_pool::SshChannelGuard,
};

pub type SftpResult<T> = anyhow::Result<T>;

trait AsyncReadWrite: AsyncRead + AsyncWrite + Unpin + Send {}

impl<T> AsyncReadWrite for T where T: AsyncRead + AsyncWrite + Unpin + Send {}

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
    rx: oneshot::Receiver<Result<ResponsePacket, ApiErr>>,
}

pub struct PendingSftpRead {
    rx: oneshot::Receiver<Result<ResponsePacket, ApiErr>>,
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

    pub async fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let offset = match pos {
            SeekFrom::Start(offset) => offset,
            SeekFrom::Current(delta) if delta >= 0 => self.offset.saturating_add(delta as u64),
            SeekFrom::Current(delta) => {
                self.offset
                    .checked_sub(delta.unsigned_abs())
                    .ok_or_else(|| {
                        std::io::Error::new(
                            std::io::ErrorKind::InvalidInput,
                            "negative seek before start",
                        )
                    })?
            }
            SeekFrom::End(_) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Unsupported,
                    "seek from end is not supported for sftp file",
                ));
            }
        };
        self.offset = offset;
        Ok(offset)
    }

    pub async fn read_exact(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let mut read_total = 0;
        while read_total < buf.len() {
            let read_len = std::cmp::min(FAST_SFTP_MAX_DATA_LEN, buf.len() - read_total);
            let data = self
                .client
                .read_at(self.handle.as_ref(), self.offset, read_len)
                .await
                .map_err(api_err_to_io)?;
            if data.is_empty() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "sftp read reached eof",
                ));
            }

            let copied = data.len().min(buf.len() - read_total);
            buf[read_total..read_total + copied].copy_from_slice(&data[..copied]);
            read_total += copied;
            self.offset += copied as u64;
        }

        Ok(read_total)
    }

    pub async fn write_all(&mut self, buf: &[u8]) -> std::io::Result<()> {
        for chunk in buf.chunks(FAST_SFTP_MAX_DATA_LEN) {
            self.client
                .write(Arc::clone(&self.handle), self.offset, chunk.into())
                .await
                .map_err(api_err_to_io)?;
            self.offset += chunk.len() as u64;
        }
        Ok(())
    }

    pub async fn flush(&mut self) -> std::io::Result<()> {
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

struct FastSftpInner {
    writer: Mutex<tokio::io::WriteHalf<Box<dyn AsyncReadWrite>>>,
    pending: Mutex<BTreeMap<u32, oneshot::Sender<Result<ResponsePacket, ApiErr>>>>,
    next_id: Mutex<u32>,
}

#[derive(Debug)]
struct ResponsePacket {
    packet_type: u8,
    payload: Vec<u8>,
}

impl FastSftpClient {
    pub async fn new(channel: SshChannelGuard) -> Result<Self, ApiErr> {
        map_ssh_err!(channel.request_subsystem(true, "sftp").await)?;
        let stream = channel
            .into_stream()
            .ok_or_else(|| protocol_err("missing ssh channel"))?;
        Self::new_with_stream(Box::new(stream)).await
    }

    pub async fn new_from_channel(channel: Channel<Msg>) -> SftpResult<Self> {
        channel.request_subsystem(true, "sftp").await?;
        Self::new_with_stream(Box::new(channel.into_stream()))
            .await
            .map_err(|err| anyhow::anyhow!(err.message))
    }

    async fn new_with_stream(mut stream: Box<dyn AsyncReadWrite>) -> Result<Self, ApiErr> {
        write_raw_packet_to(&mut stream, SSH_FXP_INIT, &[0, 0, 0, 3]).await?;
        let version_packet = read_packet(&mut stream).await?;
        if version_packet.packet_type != SSH_FXP_VERSION {
            return Err(protocol_err(format!(
                "expected SFTP VERSION, got {}",
                version_packet.packet_type
            )));
        }

        let (reader, writer) = tokio::io::split(stream);
        let inner = Arc::new(FastSftpInner {
            writer: Mutex::new(writer),
            pending: Mutex::new(BTreeMap::new()),
            next_id: Mutex::new(1),
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
                    entries.extend(parse_name_entries(&response.payload)?);
                }
                SSH_FXP_STATUS => {
                    let status = parse_status_packet(&response.payload)?;
                    if status.code == SSH_FX_EOF {
                        break;
                    }
                    return Err(anyhow::anyhow!(status.message));
                }
                packet_type => {
                    return Err(anyhow::anyhow!("expected SFTP NAME, got {packet_type}"));
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
        if response.packet_type != SSH_FXP_ATTRS {
            return Err(anyhow::anyhow!(
                "expected SFTP ATTRS, got {}",
                response.packet_type
            ));
        }

        Ok(parse_attrs(&response.payload)?)
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

    pub async fn open_read_handle<T: Into<String>>(&self, path: T) -> Result<Vec<u8>, ApiErr> {
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

    pub async fn open_upload(&self, path: &str, size: u64) -> Result<Vec<u8>, ApiErr> {
        let mut payload = Vec::new();
        put_string(&mut payload, path.as_bytes());
        put_u32(&mut payload, SSH_FXF_WRITE | SSH_FXF_CREAT | SSH_FXF_TRUNC);
        put_size_attrs(&mut payload, size);

        self.open_handle_for(SSH_FXP_OPEN, payload).await
    }

    pub async fn open_upload_range(&self, path: &str) -> Result<Vec<u8>, ApiErr> {
        let mut payload = Vec::new();
        put_string(&mut payload, path.as_bytes());
        put_u32(&mut payload, SSH_FXF_WRITE | SSH_FXF_CREAT);
        put_u32(&mut payload, 0);

        self.open_handle_for(SSH_FXP_OPEN, payload).await
    }

    async fn open_handle_for(&self, packet_type: u8, payload: Vec<u8>) -> Result<Vec<u8>, ApiErr> {
        let response = self.request(packet_type, payload).await?;
        if response.packet_type != SSH_FXP_HANDLE {
            return Err(protocol_err(format!(
                "expected SFTP HANDLE, got {}",
                response.packet_type
            )));
        }

        let mut cursor = Cursor::new(&response.payload);
        Ok(cursor.read_string()?.to_vec())
    }

    pub async fn set_size(&self, handle: &[u8], size: u64) -> Result<(), ApiErr> {
        let mut payload = Vec::new();
        put_string(&mut payload, handle);
        put_size_attrs(&mut payload, size);
        self.request_status(SSH_FXP_FSETSTAT, payload).await
    }

    pub async fn write(
        &self,
        handle: Arc<[u8]>,
        offset: u64,
        data: Box<[u8]>,
    ) -> Result<(), ApiErr> {
        self.begin_write(handle, offset, data).await?.wait().await
    }

    pub async fn begin_write(
        &self,
        handle: Arc<[u8]>,
        offset: u64,
        data: Box<[u8]>,
    ) -> Result<PendingSftpWrite, ApiErr> {
        self.request_write(handle.as_ref(), offset, &data).await
    }

    pub async fn begin_read(
        &self,
        handle: Arc<[u8]>,
        offset: u64,
        len: usize,
    ) -> Result<PendingSftpRead, ApiErr> {
        let mut payload = Vec::new();
        put_string(&mut payload, handle.as_ref());
        put_u64(&mut payload, offset);
        put_u32(&mut payload, len as u32);
        let pending = self.request_pending(SSH_FXP_READ, payload).await?;
        Ok(PendingSftpRead { rx: pending.rx })
    }

    pub async fn close(&self, handle: Vec<u8>) -> Result<(), ApiErr> {
        let mut payload = Vec::new();
        put_string(&mut payload, &handle);
        self.request_status(SSH_FXP_CLOSE, payload).await
    }

    pub async fn shutdown(&self) {
        let _ = self.inner.writer.lock().await.shutdown().await;
        if let Some(task) = self.read_task.lock().await.take() {
            task.abort();
        }
        fail_all_pending(self.inner.as_ref(), protocol_err("sftp client shutdown")).await;
    }

    async fn close_arc(&self, handle: Arc<[u8]>) -> Result<(), ApiErr> {
        let mut payload = Vec::new();
        put_string(&mut payload, handle.as_ref());
        self.request_status(SSH_FXP_CLOSE, payload).await
    }

    async fn set_handle_metadata(&self, handle: &[u8], metadata: SftpAttrs) -> Result<(), ApiErr> {
        let mut payload = Vec::new();
        put_string(&mut payload, handle);
        put_attrs(&mut payload, &metadata);
        self.request_status(SSH_FXP_FSETSTAT, payload).await
    }

    async fn read_at(&self, handle: &[u8], offset: u64, len: usize) -> Result<Vec<u8>, ApiErr> {
        let mut payload = Vec::new();
        put_string(&mut payload, handle);
        put_u64(&mut payload, offset);
        put_u32(&mut payload, len as u32);

        let response = self.request(SSH_FXP_READ, payload).await?;
        match response.packet_type {
            SSH_FXP_DATA => payload_into_data(response.payload),
            SSH_FXP_STATUS => {
                let status = parse_status_packet(&response.payload)?;
                if status.code == SSH_FX_EOF {
                    Ok(Vec::new())
                } else {
                    Err(protocol_err(status.message))
                }
            }
            packet_type => Err(protocol_err(format!(
                "expected SFTP DATA, got {packet_type}"
            ))),
        }
    }

    async fn request_status(&self, packet_type: u8, payload: Vec<u8>) -> Result<(), ApiErr> {
        let response = self.request(packet_type, payload).await?;
        if response.packet_type != SSH_FXP_STATUS {
            return Err(protocol_err(format!(
                "expected SFTP STATUS, got {}",
                response.packet_type
            )));
        }

        parse_status(&response.payload)
    }

    async fn request(&self, packet_type: u8, payload: Vec<u8>) -> Result<ResponsePacket, ApiErr> {
        self.request_pending(packet_type, payload)
            .await?
            .wait()
            .await
    }

    async fn request_pending(
        &self,
        packet_type: u8,
        mut payload: Vec<u8>,
    ) -> Result<PendingSftpRequest, ApiErr> {
        let id = self.next_id().await;
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
    ) -> Result<PendingSftpWrite, ApiErr> {
        let id = self.next_id().await;
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

    async fn next_id(&self) -> u32 {
        let mut id = self.inner.next_id.lock().await;
        let current = *id;
        *id = id.wrapping_add(1).max(1);
        current
    }
}

struct PendingSftpRequest {
    rx: oneshot::Receiver<Result<ResponsePacket, ApiErr>>,
}

impl PendingSftpRequest {
    async fn wait(self) -> Result<ResponsePacket, ApiErr> {
        self.rx
            .await
            .map_err(|_| protocol_err("sftp response channel closed"))?
    }
}

impl PendingSftpWrite {
    pub async fn wait(self) -> Result<(), ApiErr> {
        let response = self
            .rx
            .await
            .map_err(|_| protocol_err("sftp response channel closed"))??;
        if response.packet_type != SSH_FXP_STATUS {
            return Err(protocol_err(format!(
                "expected SFTP STATUS, got {}",
                response.packet_type
            )));
        }

        parse_status(&response.payload)
    }
}

impl PendingSftpRead {
    pub async fn wait(self) -> Result<Vec<u8>, ApiErr> {
        let response = self
            .rx
            .await
            .map_err(|_| protocol_err("sftp response channel closed"))??;
        match response.packet_type {
            SSH_FXP_DATA => payload_into_data(response.payload),
            SSH_FXP_STATUS => {
                let status = parse_status_packet(&response.payload)?;
                if status.code == SSH_FX_EOF {
                    Ok(Vec::new())
                } else {
                    Err(protocol_err(status.message))
                }
            }
            packet_type => Err(protocol_err(format!(
                "expected SFTP DATA, got {packet_type}"
            ))),
        }
    }
}

async fn read_loop<R>(mut reader: R, inner: Arc<FastSftpInner>)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    loop {
        let packet = read_packet(&mut reader).await;
        let packet = match packet {
            Ok(packet) => packet,
            Err(err) => {
                fail_all_pending(&inner, err).await;
                break;
            }
        };

        let Some((id, payload)) = split_response_id(packet.payload) else {
            fail_all_pending(&inner, protocol_err("sftp response missing id")).await;
            break;
        };

        if let Some(tx) = inner.pending.lock().await.remove(&id) {
            let _ = tx.send(Ok(ResponsePacket {
                packet_type: packet.packet_type,
                payload,
            }));
        }
    }
}

async fn fail_all_pending(inner: &FastSftpInner, err: ApiErr) {
    let mut pending = inner.pending.lock().await;
    for (_, tx) in std::mem::take(&mut *pending) {
        let _ = tx.send(Err(ApiErr {
            code: err.code,
            message: err.message.clone(),
        }));
    }
}

async fn write_raw_packet<W>(
    writer: &Mutex<W>,
    packet_type: u8,
    payload: &[u8],
) -> Result<(), ApiErr>
where
    W: AsyncWrite + Unpin,
{
    let len = payload.len() + 1;
    if len > u32::MAX as usize {
        return Err(protocol_err("sftp packet too large"));
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
) -> Result<(), ApiErr>
where
    W: AsyncWrite + Unpin,
{
    let payload_len = 4 + 4 + handle.len() + 8 + 4 + data.len();
    let len = payload_len + 1;
    if len > u32::MAX as usize {
        return Err(protocol_err("sftp packet too large"));
    }

    let mut header = Vec::with_capacity(4 + 1 + 4 + 4 + handle.len() + 8 + 4);
    put_u32(&mut header, len as u32);
    header.push(SSH_FXP_WRITE);
    put_u32(&mut header, id);
    put_string(&mut header, handle);
    put_u64(&mut header, offset);
    put_u32(&mut header, data.len() as u32);

    let mut writer = writer.lock().await;
    writer.write_all(&header).await.map_err(map_io_err)?;
    writer.write_all(data).await.map_err(map_io_err)?;
    Ok(())
}

async fn write_raw_packet_to<W>(
    writer: &mut W,
    packet_type: u8,
    payload: &[u8],
) -> Result<(), ApiErr>
where
    W: AsyncWrite + Unpin,
{
    let len = payload.len() + 1;
    if len > u32::MAX as usize {
        return Err(protocol_err("sftp packet too large"));
    }

    writer
        .write_all(&(len as u32).to_be_bytes())
        .await
        .map_err(map_io_err)?;
    writer.write_all(&[packet_type]).await.map_err(map_io_err)?;
    writer.write_all(payload).await.map_err(map_io_err)?;
    Ok(())
}

async fn read_packet<R>(reader: &mut R) -> Result<ResponsePacket, ApiErr>
where
    R: AsyncRead + Unpin,
{
    let len = reader.read_u32().await.map_err(map_io_err)? as usize;
    if len == 0 {
        return Err(protocol_err("empty sftp packet"));
    }
    let packet_type = reader.read_u8().await.map_err(map_io_err)?;
    let mut payload = vec![0; len - 1];
    reader.read_exact(&mut payload).await.map_err(map_io_err)?;
    Ok(ResponsePacket {
        packet_type,
        payload,
    })
}

fn split_response_id(mut payload: Vec<u8>) -> Option<(u32, Vec<u8>)> {
    if payload.len() < 4 {
        return None;
    }
    let id = u32::from_be_bytes(payload[0..4].try_into().ok()?);
    let payload = payload.split_off(4);
    Some((id, payload))
}

fn payload_into_data(mut payload: Vec<u8>) -> Result<Vec<u8>, ApiErr> {
    if payload.len() < 4 {
        return Err(protocol_err("unexpected end of sftp packet"));
    }
    let len = u32::from_be_bytes(
        payload[0..4]
            .try_into()
            .map_err(|_| protocol_err("invalid data length"))?,
    ) as usize;
    if payload.len() - 4 < len {
        return Err(protocol_err("unexpected end of sftp string"));
    }
    if payload.len() - 4 == len {
        Ok(payload.split_off(4))
    } else {
        let mut data = payload.split_off(4);
        data.truncate(len);
        Ok(data)
    }
}

struct SftpStatus {
    code: u32,
    message: String,
}

fn parse_status(payload: &[u8]) -> Result<(), ApiErr> {
    let status = parse_status_packet(payload)?;
    if status.code == SSH_FX_OK {
        return Ok(());
    }

    Err(protocol_err(format!(
        "sftp status {}: {}",
        status.code, status.message
    )))
}

fn parse_status_packet(payload: &[u8]) -> Result<SftpStatus, ApiErr> {
    let mut cursor = Cursor::new(payload);
    let code = cursor.read_u32()?;
    let message = cursor
        .read_string()
        .map(|bytes| String::from_utf8_lossy(bytes).to_string())
        .unwrap_or_else(|_| format!("status code {code}"));
    Ok(SftpStatus { code, message })
}

fn parse_name_entries(payload: &[u8]) -> Result<Vec<SftpDirEntry>, ApiErr> {
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

fn parse_attrs(payload: &[u8]) -> Result<SftpAttrs, ApiErr> {
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

    fn read_u32(&mut self) -> Result<u32, ApiErr> {
        if self.offset + 4 > self.bytes.len() {
            return Err(protocol_err("unexpected end of sftp packet"));
        }
        let value = u32::from_be_bytes(
            self.bytes[self.offset..self.offset + 4]
                .try_into()
                .map_err(|_| protocol_err("invalid u32"))?,
        );
        self.offset += 4;
        Ok(value)
    }

    fn read_u64(&mut self) -> Result<u64, ApiErr> {
        if self.offset + 8 > self.bytes.len() {
            return Err(protocol_err("unexpected end of sftp packet"));
        }
        let value = u64::from_be_bytes(
            self.bytes[self.offset..self.offset + 8]
                .try_into()
                .map_err(|_| protocol_err("invalid u64"))?,
        );
        self.offset += 8;
        Ok(value)
    }

    fn read_string(&mut self) -> Result<&'a [u8], ApiErr> {
        let len = self.read_u32()? as usize;
        if self.offset + len > self.bytes.len() {
            return Err(protocol_err("unexpected end of sftp string"));
        }
        let value = &self.bytes[self.offset..self.offset + len];
        self.offset += len;
        Ok(value)
    }

    fn read_attrs(&mut self) -> Result<SftpAttrs, ApiErr> {
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

fn protocol_err(message: impl Into<String>) -> ApiErr {
    ApiErr {
        code: ERR_CODE_SSH_ERR,
        message: message.into(),
    }
}

fn map_io_err(err: std::io::Error) -> ApiErr {
    ApiErr {
        code: ERR_CODE_SSH_ERR,
        message: err.to_string(),
    }
}

fn api_err_to_io(err: ApiErr) -> std::io::Error {
    std::io::Error::other(err.message)
}

#[cfg(test)]
mod tests {
    use tokio::io::duplex;

    use super::*;

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
    fn parse_status_accepts_ok_and_reports_error_message() {
        parse_status(&0u32.to_be_bytes()).expect("ok status");

        let mut payload = Vec::new();
        put_u32(&mut payload, 4);
        put_string(&mut payload, b"failure");

        let err = parse_status(&payload).expect_err("error status");
        assert!(err.message.contains("failure"));
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
        assert_eq!(packet.payload, payload);
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
            let (id, payload) = split_response_id(open.payload).expect("open id");
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
            respond_status_ok(&mut server_stream, setstat.payload).await;

            let write = read_packet(&mut server_stream).await.expect("write packet");
            assert_eq!(write.packet_type, SSH_FXP_WRITE);
            let write_id = inspect_write_request(write.payload);
            respond_status_ok_with_id(&mut server_stream, write_id).await;

            let close = read_packet(&mut server_stream).await.expect("close packet");
            assert_eq!(close.packet_type, SSH_FXP_CLOSE);
            respond_status_ok(&mut server_stream, close.payload).await;
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
            let (id, payload) = split_response_id(open.payload).expect("open id");
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
            let read_id = inspect_read_request(read.payload);
            let mut data_response = Vec::new();
            put_u32(&mut data_response, read_id);
            put_string(&mut data_response, b"abc");
            write_raw_packet_to(&mut server_stream, SSH_FXP_DATA, &data_response)
                .await
                .expect("data response");

            let close = read_packet(&mut server_stream).await.expect("close packet");
            assert_eq!(close.packet_type, SSH_FXP_CLOSE);
            respond_status_ok(&mut server_stream, close.payload).await;
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
