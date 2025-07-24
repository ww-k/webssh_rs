use std::sync::Arc;

use axum::{Router, routing::post};

use crate::{
    AppState,
    services::handlers::{ssh_exec, ssh_terminal::svc_ssh_terminal_router_builder},
    ssh_session_pool::SshSessionPool,
};

pub(crate) fn svc_ssh_router_builder(
    _app_state: Arc<AppState>,
    session_pool: Arc<SshSessionPool>,
) -> Router {
    Router::new()
        .nest(
            "/terminal",
            svc_ssh_terminal_router_builder(session_pool.clone()),
        )
        .route("/exec", post(ssh_exec::handler))
        .fallback(|| async { "not supported" })
        .with_state(session_pool)
}
