use std::collections::HashMap;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use russh::keys::ssh_key;
use russh::server::{Auth, ChannelOpenHandle, Msg, Session, run_stream};
use russh::{Channel, ChannelId, Disconnect};
use russh_sftp::protocol::{
    Attrs, Data, File, FileAttributes, Handle, Name, OpenFlags, Status, StatusCode, Version,
};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Semaphore, broadcast};
use tracing::{debug, error, info};

pub(crate) const DOWNLOAD_FILE_SIZE: usize = 20_000;
pub(crate) const DOWNLOAD_FILE_PATH: &str = "/download.bin";

#[derive(Clone)]
pub(crate) struct ChannelOpenControl {
    inner: Arc<ChannelOpenControlInner>,
}

struct ChannelOpenControlInner {
    block_next: AtomicBool,
    entered: Semaphore,
    release: Semaphore,
}

impl ChannelOpenControl {
    fn new() -> Self {
        Self {
            inner: Arc::new(ChannelOpenControlInner {
                block_next: AtomicBool::new(false),
                entered: Semaphore::new(0),
                release: Semaphore::new(0),
            }),
        }
    }

    pub(crate) fn block_next(&self) {
        assert!(
            !self.inner.block_next.swap(true, Ordering::AcqRel),
            "a channel-open gate is already armed"
        );
    }

    pub(crate) async fn wait_until_blocked(&self) {
        self.inner.entered.acquire().await.unwrap().forget();
    }

    pub(crate) fn release(&self) {
        self.inner.release.add_permits(1);
    }

    async fn wait_if_blocked(&self) {
        if self.inner.block_next.swap(false, Ordering::AcqRel) {
            self.inner.entered.add_permits(1);
            self.inner.release.acquire().await.unwrap().forget();
        }
    }
}

async fn run_on_socket(
    config: Arc<russh::server::Config>,
    socket: &tokio::net::TcpListener,
    disconnect_tx: broadcast::Sender<String>,
    channel_open_control: ChannelOpenControl,
) {
    loop {
        info!("SftpServer: @run_on_socket in loop start");
        let accept_result = socket.accept().await;

        match accept_result {
            Ok((socket, _)) => {
                let socket_addr = socket.peer_addr().unwrap();
                let mut disconnect_rx = disconnect_tx.subscribe();
                let config = config.clone();
                let handler = SshServerSession::new(channel_open_control.clone());

                info!(
                    "SftpServer: @run_on_socket socket accepted {:?}",
                    socket_addr
                );

                tokio::spawn(async move {
                    let session = run_stream(config, socket, handler).await.unwrap();
                    let handle = session.handle();

                    info!("SftpServer: @run_on_socket run_stream run success");
                    tokio::select! {
                        reason = disconnect_rx.recv() => {
                            info!("SftpServer: @run_on_socket run_stream recv disconnect message");
                            if handle.disconnect(
                                Disconnect::ByApplication,
                                reason.unwrap_or_else(|_| "".into()),
                                "".into()
                            ).await.is_err() {
                                debug!("SftpServer: @run_on_socket run_stream Failed to send disconnect message");
                            }
                        },
                        result = session => {
                            if let Err(err) = result {
                                debug!("SftpServer: @run_on_socket run_stream Connection closed with error. {:?}", err);
                            } else {
                                debug!("SftpServer: @run_on_socket run_stream Connection closed");
                            }
                        }
                    }

                    info!("SftpServer: @run_on_socket run_stream done");
                });
            }
            Err(err) => {
                debug!("SftpServer: @run_on_socket socket.accept error. {:?}", err);
            }
        }
        info!("SftpServer: @run_on_socket in loop end");
    }
}

struct SshServerSession {
    channels: Arc<Mutex<HashMap<ChannelId, Channel<Msg>>>>,
    channel_open_control: ChannelOpenControl,
}

impl SshServerSession {
    fn new(channel_open_control: ChannelOpenControl) -> Self {
        Self {
            channels: Arc::new(Mutex::new(HashMap::new())),
            channel_open_control,
        }
    }

    pub async fn get_channel(&mut self, channel_id: ChannelId) -> Channel<Msg> {
        let mut channels = self.channels.lock().await;
        channels.remove(&channel_id).unwrap()
    }
}

impl russh::server::Handler for SshServerSession {
    type Error = anyhow::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        info!("SshServerSession: @auth_password {}, {}", user, password);
        Ok(Auth::Accept)
    }

    async fn auth_publickey(
        &mut self,
        user: &str,
        public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<Auth, Self::Error> {
        info!(
            "SshServerSession: @auth_publickey {}, {:?}",
            user, public_key
        );
        Ok(Auth::Accept)
    }

    fn auth_succeeded(
        &mut self,
        _session: &mut Session,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send {
        info!("SshServerSession: @auth_succeeded");
        async { Ok(()) }
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channel_open_control.wait_if_blocked().await;
        {
            let mut channels = self.channels.lock().await;
            let channel_id = channel.id();
            info!("SshServerSession: channel_open_session {}", channel_id);
            channels.insert(channel_id, channel);
        }
        reply.accept().await;
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        // After a client has sent an EOF, indicating that they don't want
        // to send more data in this session, the channel can be closed.
        session.close(channel)?;
        Ok(())
    }

    fn exec_request(
        &mut self,
        channel: ChannelId,
        cmd: &[u8],
        _session: &mut Session,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send {
        async move {
            let channels = self.channels.lock().await;
            if let Some(channel) = channels.get(&channel) {
                let cmd_str = String::from_utf8_lossy(cmd);
                let exec = "exec ".as_bytes();
                let done = " done".as_bytes();
                let combined = [exec, cmd, done].concat();
                let _ = channel.data(combined.as_slice()).await;
                channel.exit_status(0).await?;
                channel.eof().await?;
                if cmd_str == "close_channel" {
                    channel.close().await?;
                }
                Ok(())
            } else {
                anyhow::bail!("channel not found")
            }
        }
    }

    async fn subsystem_request(
        &mut self,
        channel_id: ChannelId,
        name: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        info!(
            "SshServerSession: subsystem_request@ {} {}",
            channel_id, name
        );

        if name == "sftp" {
            let channel = self.get_channel(channel_id).await;
            let sftp = SftpServerSession::default();
            session.channel_success(channel_id)?;
            russh_sftp::server::run(channel.into_stream(), sftp).await;
        } else {
            session.channel_failure(channel_id)?;
        }

        Ok(())
    }
}

#[derive(Default)]
struct SftpServerSession {
    version: Option<u32>,
    root_dir_read_done: bool,
}

impl russh_sftp::server::Handler for SftpServerSession {
    type Error = StatusCode;

    fn unimplemented(&self) -> Self::Error {
        StatusCode::OpUnsupported
    }

    async fn init(
        &mut self,
        version: u32,
        extensions: HashMap<String, String>,
    ) -> Result<Version, Self::Error> {
        info!(
            "SftpServerSession: @init version: {:?}, extensions: {:?}",
            self.version, extensions
        );
        if self.version.is_some() {
            error!("duplicate SSH_FXP_VERSION packet");
            return Err(StatusCode::ConnectionLost);
        }

        info!("SftpServerSession: @init Ok");
        self.version = Some(version);
        Ok(Version::new())
    }

    async fn close(&mut self, id: u32, _handle: String) -> Result<Status, Self::Error> {
        Ok(Status {
            id,
            status_code: StatusCode::Ok,
            error_message: "Ok".to_string(),
            language_tag: "en-US".to_string(),
        })
    }

    async fn open(
        &mut self,
        id: u32,
        filename: String,
        _pflags: OpenFlags,
        _attrs: FileAttributes,
    ) -> Result<Handle, Self::Error> {
        if filename != DOWNLOAD_FILE_PATH {
            return Err(StatusCode::NoSuchFile);
        }
        Ok(Handle {
            id,
            handle: filename,
        })
    }

    async fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> Result<Data, Self::Error> {
        if handle != DOWNLOAD_FILE_PATH {
            return Err(StatusCode::Failure);
        }
        let offset = usize::try_from(offset).map_err(|_| StatusCode::Failure)?;
        if offset >= DOWNLOAD_FILE_SIZE {
            return Err(StatusCode::Eof);
        }
        let len = usize::try_from(len).map_err(|_| StatusCode::Failure)?;
        let end = offset.saturating_add(len).min(DOWNLOAD_FILE_SIZE);
        let data = (offset..end).map(|index| (index % 251) as u8).collect();
        Ok(Data { id, data })
    }

    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        if path != DOWNLOAD_FILE_PATH {
            return Err(StatusCode::NoSuchFile);
        }
        Ok(Attrs {
            id,
            attrs: FileAttributes {
                size: Some(DOWNLOAD_FILE_SIZE as u64),
                permissions: Some(0o100644),
                ..FileAttributes::default()
            },
        })
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, Self::Error> {
        info!("SftpServerSession: @opendir {}", path);
        self.root_dir_read_done = false;
        Ok(Handle { id, handle: path })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, Self::Error> {
        info!("SftpServerSession: @readdir handle {}", handle);
        if handle == "/" && !self.root_dir_read_done {
            self.root_dir_read_done = true;
            return Ok(Name {
                id,
                files: vec![
                    File::new("foo", FileAttributes::default()),
                    File::new("bar", FileAttributes::default()),
                ],
            });
        }
        // If all files have been sent to the client, respond with an EOF
        Err(StatusCode::Eof)
    }

    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        info!("SftpServerSession: @realpath {}", path);
        Ok(Name {
            id,
            files: vec![File::dummy("/")],
        })
    }
}

pub(crate) async fn run_server_with_channel_control()
-> Result<(broadcast::Sender<String>, ChannelOpenControl), std::io::Error> {
    let config = Arc::new(russh::server::Config {
        keys: vec![
            russh::keys::PrivateKey::random(&mut rand::rng(), ssh_key::Algorithm::Ed25519).unwrap(),
        ],
        ..Default::default()
    });

    let socket = TcpListener::bind(("127.0.0.1", 2222)).await?;
    info!("SftpServer: run on 127.0.0.1 2222");

    let (disconnect_tx, _) = broadcast::channel(1);
    let disconnect_tx2 = disconnect_tx.clone();
    let channel_open_control = ChannelOpenControl::new();
    let server_control = channel_open_control.clone();
    tokio::spawn(async move {
        run_on_socket(config, &socket, disconnect_tx2, server_control).await;
    });

    Ok((disconnect_tx, channel_open_control))
}

// #[tokio::test]
// async fn start_sftp_server() {
//     let config = Arc::new(russh::server::Config {
//         keys: vec![
//             russh::keys::PrivateKey::random(&mut OsRng, ssh_key::Algorithm::Ed25519).unwrap(),
//         ],
//         ..Default::default()
//     });

//     let socket = TcpListener::bind(("127.0.0.1", 2222)).await.unwrap();
//     info!("SftpServer: run on 127.0.0.1 2222");

//     let (disconnect_tx, _) = broadcast::channel(1);
//     run_on_socket(config, &socket, disconnect_tx).await;
// }
