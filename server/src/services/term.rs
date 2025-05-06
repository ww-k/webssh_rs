use std::sync::Arc;

use axum::Router;
use socketioxide::{
    SocketIo,
    extract::{Data, SocketRef},
};
use tracing::{debug, info};

use crate::AppState;

pub(crate) fn svc_term_router_builder(app_state: Arc<AppState>) -> Router {
    let (svc, io) = SocketIo::new_svc();
    io.ns("/", |socket: SocketRef| async move {
        debug!("io connected: {:?}", socket.id);
        socket.on(
            "input",
            |socket: SocketRef, Data::<String>(data)| async move {
                socket.emit("output", &data).ok();
            },
        );
        socket.on_disconnect(|socket: SocketRef| {
            info!("socket disconnect {}", socket.id);
        });
    });
    Router::new().with_state(app_state).fallback_service(svc)
}
