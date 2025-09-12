use std::collections::HashMap;
use std::sync::Arc;

use rand_core::OsRng;
use russh::keys::ssh_key;
use russh::server::{Auth, Msg, Session, run_stream};
use russh::{Channel, ChannelId, Disconnect};
use russh_sftp::protocol::{File, FileAttributes, Handle, Name, Status, StatusCode, Version};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, broadcast};
use tracing::{debug, error, info};

async fn run_on_socket(
    config: Arc<russh::server::Config>,
    socket: &tokio::net::TcpListener,
    disconnect_tx: broadcast::Sender<String>,
) {
    loop {
        info!("SftpServer: @run_on_socket in loop start");
        let accept_result = socket.accept().await;

        match accept_result {
            Ok((socket, _)) => {
                let socket_addr = socket.peer_addr().unwrap();
                let mut disconnect_rx = disconnect_tx.subscribe();
                let config = config.clone();
                let handler = SshServerSession::new();

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
}

impl SshServerSession {
    fn new() -> Self {
        Self {
            channels: Arc::new(Mutex::new(HashMap::new())),
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
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        {
            let mut channels = self.channels.lock().await;
            let channel_id = channel.id();
            info!("SshServerSession: channel_open_session {}", channel_id);
            channels.insert(channel_id, channel);
        }
        Ok(true)
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

pub async fn run_server() -> Result<broadcast::Sender<String>, std::io::Error> {
    let config = Arc::new(russh::server::Config {
        keys: vec![
            russh::keys::PrivateKey::random(&mut OsRng, ssh_key::Algorithm::Ed25519).unwrap(),
        ],
        ..Default::default()
    });

    let socket = TcpListener::bind(("127.0.0.1", 2222)).await?;
    info!("SftpServer: run on 127.0.0.1 2222");

    let (disconnect_tx, _) = broadcast::channel(1);
    let disconnect_tx2 = disconnect_tx.clone();
    tokio::spawn(async move {
        run_on_socket(config, &socket, disconnect_tx2).await;
    });

    Ok(disconnect_tx)
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
