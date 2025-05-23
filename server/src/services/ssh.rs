use std::{env, sync::Arc, time::Duration};

use anyhow::{Ok, Result};
use axum::Router;
use russh::{
    ChannelMsg, Disconnect, client,
    keys::{HashAlg, PrivateKeyWithHashAlg, PublicKeyBase64, decode_secret_key, ssh_key},
};
use sea_orm::EntityTrait;
use serde::Deserialize;
use socketioxide::{
    SocketIo,
    extract::{Data, SocketRef},
};
use tracing::{debug, error, info};

use crate::{
    AppState,
    entities::target::{self, TargetAuthMethod},
};

#[derive(Deserialize, Debug)]
struct QueryParams {
    connect_id: i32,
    // Add other query parameters here as needed
}

pub(crate) fn svc_ssh_router_builder(app_state: Arc<AppState>) -> Router {
    let (svc, io) = SocketIo::builder().build_svc();
    io.ns("/", async move |socket: SocketRef| {
        let sid = socket.id;
        let result = SshSvcSession::start(socket.clone(), app_state).await;

        if let Err(err) = result {
            error!("sid={} start fail. {:?}", sid, err);
            let _ = socket.disconnect();
            return;
        }
    });
    Router::new().fallback_service(svc)
}

struct SshSvcSession {
    socket: SocketRef,
    app_state: Arc<AppState>,
    ssh_client_handle: Option<client::Handle<SshClientHandler>>,
}

impl SshSvcSession {
    async fn start(socket: SocketRef, app_state: Arc<AppState>) -> Result<Self> {
        let mut term_session = SshSvcSession {
            socket,
            app_state,
            ssh_client_handle: None,
        };
        let sid = term_session.socket.id;
        let channel = tokio::select! {
            _   = tokio::time::sleep(Duration::from_secs(30)) => anyhow::bail!("connect_target tiemout"),
            res = term_session.open_target_channel() => res,
        }?;

        term_session.open_socket_channel_tunnel(channel).await;
        info!("sid={} tunnel closed", sid);

        term_session.close().await?;
        info!("sid={} session closed", sid);

        Ok(term_session)
    }

    async fn open_target_channel(&mut self) -> Result<russh::Channel<russh::client::Msg>> {
        let sid = self.socket.id;
        let target = self.get_target().await?;
        info!("sid={} get target: {:?}", sid, target);

        self.connect_target(target).await?;
        info!("sid={} target connected", sid);

        let channel = self.open_session_channel_request_pty_shell().await?;
        info!("sid={} channel opened", sid);

        Ok(channel)
    }

    async fn get_target(&self) -> Result<target::Model> {
        let sid = self.socket.id;
        let query = self.socket.req_parts().uri.query().unwrap_or_default();
        let result: Result<QueryParams, serde_qs::Error> = serde_qs::from_str(query);
        if let Err(err) = result {
            anyhow::bail!("Failed to parse query parameters: {:?}", err);
        }
        let params = result.unwrap();

        debug!("sid={} {:?}", sid, params);

        let result = target::Entity::find_by_id(params.connect_id)
            .one(&self.app_state.db)
            .await;

        if let Err(db_err) = result {
            anyhow::bail!("Failed to get target {:?}", db_err);
        }

        let model = result.unwrap();
        if model.is_none() {
            anyhow::bail!("no target found");
        }

        Ok(model.unwrap())
    }

    async fn open_socket_channel_tunnel(&self, channel: russh::Channel<russh::client::Msg>) {
        let socket = self.socket.clone();
        let sid = socket.id;
        let (mut read_half, write_half) = channel.split();
        let write_half_arc = Arc::new(write_half);

        socket.on_disconnect({
            let channel_write_half = write_half_arc.clone();
            async move |socket: SocketRef, reason: socketioxide::socket::DisconnectReason| {
                info!("sid={} socket disconnect: {:?}", socket.id, reason);
                let _ = channel_write_half.close().await;
            }
        });

        socket.on("resize", {
            let channel_write_half = write_half_arc.clone();
            async move |Data::<Resize>(data)| {
                let _ = channel_write_half
                    .window_change(data.col, data.row, 0, 0)
                    .await;
            }
        });

        socket.on("input", async move |Data::<String>(data)| {
            let _ = write_half_arc.data(data.as_bytes()).await;
        });

        loop {
            let Some(msg) = read_half.wait().await else {
                debug!("sid={} None ChannelMsg", sid);
                break;
            };
            match msg {
                ChannelMsg::Success => {
                    let _ = {
                        let _ = socket.emit("server_ready", "");
                        info!("sid={} socket channel tunnel opened", sid);
                    };
                }
                ChannelMsg::Data { ref data } => {
                    let str = String::from_utf8_lossy(data);
                    let _ = socket.emit("output", &str);
                }
                ChannelMsg::ExitStatus { exit_status } => {
                    debug!("sid={} Exitcode: {}", sid, exit_status);
                    break;
                }
                _ => {}
            }
        }
    }

    async fn connect_target(&mut self, target: target::Model) -> Result<()> {
        let config = client::Config::default();
        let sh: SshClientHandler = SshClientHandler {
            host: target.host.clone(),
        };

        let mut session = client::connect(
            Arc::new(config),
            (target.host, target.port.unwrap_or(22)),
            sh,
        )
        .await?;
        let auth_res = match target.method {
            TargetAuthMethod::Password => {
                let username = target.user;
                let password = target.password.unwrap_or("".to_string());
                session.authenticate_password(username, password).await?
            }
            TargetAuthMethod::PrivateKey => {
                let username = target.user;
                let key_data = target.key.unwrap_or("".to_string());
                let private_key = decode_secret_key(&key_data, target.password.as_deref())?;
                let private_key_with_hash_alg =
                    PrivateKeyWithHashAlg::new(Arc::new(private_key), Some(HashAlg::Sha256));
                session
                    .authenticate_publickey(username, private_key_with_hash_alg)
                    .await?
            }
            TargetAuthMethod::None => {
                todo!();
            }
        };

        if !auth_res.success() {
            anyhow::bail!("Authentication failed");
        }

        self.ssh_client_handle = Some(session);

        Ok(())
    }

    async fn open_session_channel_request_pty_shell(
        &mut self,
    ) -> Result<russh::Channel<russh::client::Msg>> {
        if self.ssh_client_handle.is_none() {
            anyhow::bail!("SSH client handle is not set");
        }

        let channel = self
            .ssh_client_handle
            .as_ref()
            .unwrap()
            .channel_open_session()
            .await?;

        // Request an interactive PTY from the server
        channel
            .request_pty(
                false,
                "xterm-256color",
                80,
                25,
                0,
                0,
                &[], // ideally you want to pass the actual terminal modes here
            )
            .await?;
        channel
            .set_env(
                false,
                "LANG",
                env::var("LANG").unwrap_or("zh_CN.UTF-8".to_string()),
            )
            .await?;
        channel.request_shell(true).await?;

        Ok(channel)
    }

    async fn close(&self) -> Result<()> {
        if let Some(handle) = self.ssh_client_handle.as_ref() {
            handle
                .disconnect(Disconnect::ByApplication, "", "English")
                .await?;
        }
        Ok(())
    }
}

#[derive(Deserialize, Debug)]
struct Resize {
    col: u32,
    row: u32,
}

struct SshClientHandler {
    host: String,
}

// More SSH event handlers
// can be defined in this trait
// In this example, we're only using Channel, so these aren't needed.
impl client::Handler for SshClientHandler {
    type Error = anyhow::Error;

    /// Called to check the server's public key. This is a very important
    /// step to help prevent man-in-the-middle attacks. The default
    /// implementation rejects all keys.
    fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send {
        debug!(
            "ClientHandler @check_server_key {} {:?}",
            self.host,
            server_public_key.public_key_base64()
        );
        async { Ok(true) }
    }
}
