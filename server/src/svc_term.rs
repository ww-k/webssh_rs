use axum::Router;
use socketioxide::{
    SocketIo,
    extract::{Data, SocketRef},
};
use tracing::{debug, info};

pub(crate) fn svc_term_router_builder() -> Router {
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
    Router::new().fallback_service(svc)
}
