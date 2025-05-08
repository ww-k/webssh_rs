use std::sync::Arc;

use anyhow::{Ok, Result};
use axum::Router;
use russh::{ChannelMsg, Disconnect, client, keys::ssh_key};
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

pub(crate) fn svc_term_router_builder(app_state: Arc<AppState>) -> Router {
    let (svc, io) = SocketIo::builder().build_svc();
    io.ns("/", async move |socket: SocketRef| {
        let result = start(socket.clone(), app_state).await;

        if let Err(err) = result {
            let _ = socket.disconnect();
            error!("{:?}", err);
            return;
        }
    });
    Router::new().fallback_service(svc)
}

async fn start(socket: SocketRef, app_state: Arc<AppState>) -> Result<()> {
    let target = get_target(socket.clone(), app_state).await?;

    let mut session = Session::connect(target).await?;

    let channel = session.open_channel().await?;
    open_tunnel(socket, channel).await;

    session.close().await?;

    Ok(())
}

async fn get_target(socket: SocketRef, app_state: Arc<AppState>) -> Result<target::Model> {
    let query = socket.req_parts().uri.query().unwrap_or_default();
    let result: Result<QueryParams, serde_qs::Error> = serde_qs::from_str(query);
    if let Err(err) = result {
        anyhow::bail!("Failed to parse query parameters: {:?}", err);
    }
    let params = result.unwrap();

    debug!("{:?}", params);

    let result = target::Entity::find_by_id(params.connect_id)
        .one(&app_state.db)
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

#[derive(Deserialize, Debug)]
struct Resize {
    col: u32,
    row: u32,
}

async fn open_tunnel(socket: SocketRef, channel: russh::Channel<russh::client::Msg>) {
    let (mut read_half, write_half) = channel.split();
    let write_half_arc = Arc::new(write_half);

    socket.on("resize", {
        let channel_write_half = write_half_arc.clone();
        async move |Data::<Resize>(data)| {
            let _ = channel_write_half
                .window_change(data.col, data.row, 0, 0)
                .await;
        }
    });

    socket.on("input", async move |Data::<String>(data)| {
        let buf: &[u8] = data.as_bytes();
        let _ = write_half_arc.data(buf).await;
    });

    loop {
        let Some(msg) = read_half.wait().await else {
            info!("None ChannelMsg");
            break;
        };
        match msg {
            ChannelMsg::Data { ref data } => {
                let str = String::from_utf8(data.to_vec()).unwrap();
                let _ = socket.emit("output", &str);
            }
            ChannelMsg::ExitStatus { exit_status } => {
                info!("Exitcode: {}", exit_status);
                break;
            }
            _ => {}
        }
    }
}

struct Client {}

// More SSH event handlers
// can be defined in this trait
// In this example, we're only using Channel, so these aren't needed.
impl client::Handler for Client {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// This struct is a convenience wrapper
/// around a russh client
pub struct Session {
    session: client::Handle<Client>,
}

impl Session {
    async fn connect(target: target::Model) -> Result<Self> {
        let config = client::Config::default();

        let config = Arc::new(config);
        let sh = Client {};

        let mut session =
            client::connect(config, (target.host, target.port.unwrap_or(22)), sh).await?;
        let auth_res = match target.method {
            TargetAuthMethod::Password => {
                let username = target.user;
                let password = target.password.unwrap();
                session.authenticate_password(username, password).await?
            }
            TargetAuthMethod::PrivateKey => {
                todo!();
            }
            TargetAuthMethod::None => {
                todo!();
            }
        };

        if !auth_res.success() {
            anyhow::bail!("Authentication (with password) failed");
        }

        Ok(Self { session })
    }

    async fn open_channel(&mut self) -> Result<russh::Channel<russh::client::Msg>> {
        let channel = self.session.channel_open_session().await?;

        // Request an interactive PTY from the server
        channel
            .request_pty(
                false,
                "xterm",
                80,
                25,
                0,
                0,
                &[], // ideally you want to pass the actual terminal modes here
            )
            .await?;
        channel.request_shell(true).await?;

        Ok(channel)
    }

    async fn close(&mut self) -> Result<()> {
        self.session
            .disconnect(Disconnect::ByApplication, "", "English")
            .await?;
        Ok(())
    }
}
