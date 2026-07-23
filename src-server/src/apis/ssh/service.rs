use anyhow::Result;
use russh::ChannelMsg;
use tracing::debug;

use crate::{
    apis::ApiErr, consts::services_err_code::*, map_ssh_err, ssh_connection_pool::SshChannelGuard,
};

pub async fn exec(mut channel: SshChannelGuard, command: &str) -> Result<String, ApiErr> {
    debug!("@exec start {:?}", command);
    map_ssh_err!(channel.exec(true, command).await)?;

    let mut code = None;
    let mut buf = Vec::<u8>::new();
    let mut buf_e = Vec::<u8>::new();

    loop {
        let Some(msg) = channel.wait().await else {
            break;
        };
        match msg {
            ChannelMsg::ExtendedData { ref data, ext: _ } => {
                buf_e.extend_from_slice(data);
            }
            ChannelMsg::Data { ref data } => {
                buf.extend_from_slice(data);
            }
            ChannelMsg::ExitStatus { exit_status } => {
                code = Some(exit_status);
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
