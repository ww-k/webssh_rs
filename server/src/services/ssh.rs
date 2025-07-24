use std::{env, sync::Arc};

use anyhow::Result;
use axum::{
    Router,
    extract::{Query, State},
    routing::post,
};
use russh::ChannelMsg;
use serde::Deserialize;
use socketioxide::{
    SocketIo,
    extract::{Data, SocketRef},
};
use tracing::{debug, error, info};

use crate::{
    AppState,
    consts::services_err_code::*,
    map_ssh_err,
    services::ApiErr,
    ssh_session_pool::{SshChannelGuard, SshSessionPool},
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
    _app_state: Arc<AppState>,
    session_pool: Arc<SshSessionPool>,
) -> Router {
    Router::new()
        .nest("/terminal", build_terminal_svg(session_pool.clone()))
        .route("/exec", post(ssh_exec))
        .fallback(|| async { "not supported" })
        .with_state(session_pool)
}

struct SshSvcSession {
    socket: SocketRef,
}

impl SshSvcSession {
    async fn start(socket: SocketRef, session_pool: Arc<SshSessionPool>) -> Result<Self> {
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

        info!(
            "sid={} target {} SshChannel {}",
            sid,
            params.target_id,
            channel.id()
        );

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

        anyhow::Ok(term_session)
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

        anyhow::Ok(channel)
    }
}

fn build_terminal_svg(session_pool: Arc<SshSessionPool>) -> Router<Arc<SshSessionPool>> {
    let state_clone = session_pool.clone();
    let (svc, io) = SocketIo::builder().build_svc();
    io.ns("/", async move |socket: SocketRef| {
        let sid = socket.id;
        let result = SshSvcSession::start(socket.clone(), session_pool).await;

        if let Err(err) = result {
            error!("sid={} start fail. {:?}", sid, err);
            let _ = socket.disconnect();
            return;
        }
    });
    Router::new().fallback_service(svc).with_state(state_clone)
}

pub async fn exec(mut channel: SshChannelGuard, command: &str) -> Result<String, ApiErr> {
    debug!("@exec start {:?}", command);
    map_ssh_err!(channel.exec(true, command).await)?;

    let mut code = None;
    let mut buf = Vec::<u8>::new();
    let mut buf_e = Vec::<u8>::new();

    loop {
        // There's an event available on the session channel
        let Some(msg) = channel.wait().await else {
            break;
        };
        match msg {
            ChannelMsg::ExtendedData { ref data, ext: _ } => {
                buf_e.extend_from_slice(data);
            }
            // Write data to the terminal
            ChannelMsg::Data { ref data } => {
                buf.extend_from_slice(data);
            }
            // The command has returned an exit code
            ChannelMsg::ExitStatus { exit_status } => {
                code = Some(exit_status);
                // cannot leave the loop immediately, there might still be more data to receive
            }
            _ => {}
        }
    }
    let str = String::from_utf8_lossy(&buf);
    let str_e = String::from_utf8_lossy(&buf_e);
    debug!("@exec done {:?}", command);
    debug!("exit_status {:?}. result ", code);
    debug!("{:?}", str);
    match code {
        Some(0) => Ok(str.to_string()),
        _ => Err(ApiErr {
            code: ERR_CODE_SSH_EXEC,
            message: format!("exit status {:?}. result\n {}", code, str_e),
        }),
    }
}

async fn ssh_exec(
    State(session_pool): State<Arc<SshSessionPool>>,
    Query(payload): Query<QueryParams>,
    body: String,
) -> Result<String, ApiErr> {
    info!("@ssh_exec {:?}", body);

    let channel = map_ssh_err!(session_pool.get(payload.target_id).await)?;
    let result = exec(channel, body.as_str()).await?;

    info!("@ssh_exec {:?} done", body);
    Ok(result)
}
