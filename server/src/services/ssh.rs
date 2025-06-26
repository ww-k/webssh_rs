use std::{env, sync::Arc};

use anyhow::{Ok, Result};
use axum::Router;
use russh::ChannelMsg;
use serde::Deserialize;
use socketioxide::{
    SocketIo,
    extract::{Data, SocketRef},
};
use tracing::{debug, error, info};

use crate::{
    AppState,
    ssh_session_pool::{SshSessionPool, SshChannelGuard},
};

#[derive(Deserialize, Debug)]
struct QueryParams {
    target_id: i32,
    // Add other query parameters here as needed
}

#[derive(Deserialize, Debug)]
struct Resize {
    col: u32,
    row: u32,
}

pub(crate) fn svc_ssh_router_builder(
    app_state: Arc<AppState>,
    session_pool: Arc<SshSessionPool>,
) -> Router {
    let (svc, io) = SocketIo::builder().build_svc();
    io.ns("/", async move |socket: SocketRef| {
        let sid = socket.id;
        let result = SshSvcSession::start(socket.clone(), app_state, session_pool).await;

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
}

impl SshSvcSession {
    async fn start(
        socket: SocketRef,
        _app_state: Arc<AppState>,
        session_pool: Arc<SshSessionPool>,
    ) -> Result<Self> {
        let query = socket.req_parts().uri.query().unwrap_or_default();
        let result: Result<QueryParams, serde_qs::Error> = serde_qs::from_str(query);
        if let Err(err) = result {
            anyhow::bail!("Failed to parse query parameters: {:?}", err);
        }
        let params = result.unwrap();
        let result = session_pool.get(params.target_id).await;
        if let Err(err) = result {
            anyhow::bail!("Failed to get channel: {:?}", err);
        }
        let sid = socket.id;
        let channel = result.unwrap();

        info!("sid={} target {} SshChannel {}", sid, params.target_id, channel.id());

        let term_session = SshSvcSession { socket };
        let result = term_session
            .open_session_channel_request_pty_shell(channel)
            .await;
        if let Err(err) = result {
            anyhow::bail!(
                "Failed to open_session_channel_request_pty_shell: {:?}",
                err
            );
        }
        info!("sid={} open_session_channel_request_pty_shell", sid);

        let channel = result.unwrap();
        term_session.open_socket_channel_tunnel(channel).await;
        info!("sid={} tunnel closed", sid);

        Ok(term_session)
    }

    async fn open_socket_channel_tunnel(&self, mut channel_guard: SshChannelGuard) {
        let socket = self.socket.clone();
        let sid = socket.id;
        let channel = channel_guard.take_channel().unwrap();
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
                ChannelMsg::Close => {
                    debug!("sid={} ChannelMsg::Close", sid);
                    break;
                }
                _ => {}
            }
        }
    }

    async fn open_session_channel_request_pty_shell(
        &self,
        channel: SshChannelGuard,
    ) -> Result<SshChannelGuard> {
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
}
