use std::{env, sync::Arc};

use anyhow::Result;
use axum::{
    Router,
    extract::{Query, State},
};
use russh::ChannelMsg;
use socketioxide::{
    SocketIo,
    extract::{Data, SocketRef},
};
use tracing::{debug, error, info};

use crate::{
    apis::{
        ApiErr, InternalErrorResponse,
        ssh::{
            dto::{QueryTargetId, Resize, TerminalQueryParams},
            service::exec,
        },
    },
    consts::services_err_code::*,
    map_ssh_err,
    ssh_connection_pool::{ChannelMode, SshChannelGuard},
    target_ssh_service::TargetSshService,
};

#[utoipa::path(
    post,
    path = "/api/ssh/exec",
    tag = "ssh",
    summary = "执行 SSH 命令",
    description = "在指定的 SSH 目标上执行命令并返回输出结果",
    operation_id = "ssh_exec",
    params(
        QueryTargetId
    ),
    request_body(
        content = String,
        description = "要执行的命令",
        example = "ls -la"
    ),
    responses(
        (status = 200, description = "成功执行命令", body = String),
        (status = 500, response = InternalErrorResponse)
    )
)]
pub(crate) async fn exec_handler(
    State(ssh_service): State<Arc<TargetSshService>>,
    Query(payload): Query<QueryTargetId>,
    body: String,
) -> Result<String, ApiErr> {
    info!("@ssh_exec {:?}", body);

    let channel = map_ssh_err!(
        ssh_service
            .channel(payload.target_id, ChannelMode::Shared)
            .await
    )?;
    let result = exec(channel, body.as_str()).await?;

    info!("@ssh_exec {:?} done", body);
    Ok(result)
}

pub(crate) fn terminal_router_builder(
    ssh_service: Arc<TargetSshService>,
) -> Router<Arc<TargetSshService>> {
    let ssh_service_clone = ssh_service.clone();
    let (svc, io) = SocketIo::builder().build_svc();
    io.ns("/", async move |socket: SocketRef| {
        let sid = socket.id;
        let result = SshTerminalSession::start(socket.clone(), ssh_service).await;

        if let Err(err) = result {
            error!("sid={} start fail. {:?}", sid, err);
            let _ = socket.disconnect();
            return;
        }
    });
    Router::new()
        .fallback_service(svc)
        .with_state(ssh_service_clone)
}

struct SshTerminalSession {
    socket: SocketRef,
}

impl SshTerminalSession {
    async fn start(socket: SocketRef, ssh_service: Arc<TargetSshService>) -> Result<Self> {
        let query = socket.req_parts().uri.query().unwrap_or_default();
        let result: Result<TerminalQueryParams, serde_qs::Error> = serde_qs::from_str(query);
        if let Err(err) = result {
            anyhow::bail!("Failed to parse query parameters: {:?}", err);
        }
        let params = result.unwrap();
        let result = ssh_service
            .channel(params.target_id, ChannelMode::Shared)
            .await;
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

        let term_session = SshTerminalSession { socket };
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

    async fn open_socket_channel_tunnel(&self, channel_guard: SshChannelGuard) {
        let socket = self.socket.clone();
        let sid = socket.id;
        let (mut read_half, write_half, channel_lease) = channel_guard.split().unwrap();
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

        socket.on("input", {
            let channel_write_half = write_half_arc.clone();
            async move |Data::<String>(data)| {
                let _ = channel_write_half.data(data.as_bytes()).await;
            }
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

        let cleanup = tokio::spawn(async move {
            let _ = write_half_arc.close().await;
            drop(channel_lease);
        });
        let _ = cleanup.await;
    }

    async fn open_session_channel_request_pty_shell(
        &self,
        channel: SshChannelGuard,
    ) -> Result<SshChannelGuard> {
        channel
            .request_pty(false, "xterm-256color", 80, 25, 0, 0, &[])
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
