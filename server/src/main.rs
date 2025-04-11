use axum::Router;
use socketioxide::{extract::{Data, SocketRef}, SocketIo};
use tower_http::services::ServeDir;
use tracing::{debug, info};
use tracing_subscriber::{EnvFilter, FmtSubscriber};

#[tokio::main]
async fn main() {
    let subscriber = FmtSubscriber::builder()
        // "engineioxide=debug,socketioxide=debug,info"
        .with_env_filter(EnvFilter::from_default_env())
        .finish();

    tracing::subscriber::set_global_default(subscriber).unwrap();

    info!("Starting server...");

    let app = Router::new()
        .nest("/term", socket_router_builder())
        .fallback_service(ServeDir::new("../client"));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8080")
        .await
        .unwrap();
    info!("Listening on http://{}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}

fn socket_router_builder() -> Router {
    let (svc, io) = SocketIo::new_svc();
    io.ns("/", |socket: SocketRef| async move {
        debug!("io connected: {:?}", socket.id);
        socket.on("input", |socket: SocketRef, Data::<String>(data)| async move {
            socket.emit("output", &data).ok();
        });
        socket.on_disconnect(|socket: SocketRef| {
            info!("socket disconnect {}", socket.id);
        });
    });
    Router::new().fallback_service(svc)
}
