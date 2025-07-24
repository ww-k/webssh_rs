use std::sync::Arc;

use anyhow::Result;
use axum::extract::{Query, State};
use russh::ChannelMsg;
use tracing::{debug, info};

use crate::{
    consts::services_err_code::*,
    map_ssh_err,
    services::{ApiErr, handlers::QueryTargetId},
    ssh_session_pool::{SshChannelGuard, SshSessionPool},
};

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

pub async fn handler(
    State(session_pool): State<Arc<SshSessionPool>>,
    Query(payload): Query<QueryTargetId>,
    body: String,
) -> Result<String, ApiErr> {
    info!("@ssh_exec {:?}", body);

    let channel = map_ssh_err!(session_pool.get(payload.target_id).await)?;
    let result = exec(channel, body.as_str()).await?;

    info!("@ssh_exec {:?} done", body);
    Ok(result)
}
