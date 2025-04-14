use axum::{
    routing::{get, post}, Json, Router
};
use serde::{Deserialize};

// connection service
// 1. get a list of binded connections
// 2. add a new connection
// 3. remove a connection

pub(crate) fn svc_connection_router_builder() -> Router {
    Router::new()
        .route("/list", get(connection_list))
        .route("/add", post(connection_add))
        .route("/remove", post(connection_remove))
        .fallback(|| async { "not supported" })
}

#[derive(serde::Deserialize)]
enum ConnectionAuthMethod {
    Password = 1,
    PublicKey = 2,
    None = 3,
    // HostBased,
    // KeyboardInteractive,
}

#[derive(Deserialize)]
struct ConnectionAddPayload {
    host: String,
    port: u16,
    user: String,
    password: String,
    method: ConnectionAuthMethod,
}

async fn connection_list() {
    // get a list of binded connections
}

async fn connection_add(Json(payload): Json<ConnectionAddPayload>) {
    // add a new connection
}

async fn connection_remove() {
    // remove a connection
}
