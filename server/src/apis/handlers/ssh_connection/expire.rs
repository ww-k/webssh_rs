use std::sync::Arc;

use axum::extract::{Query, State};
use serde::Deserialize;
use tracing::{debug, info};

use crate::{apis::ApiErr, ssh_session_pool::SshSessionPool};

#[derive(Debug, Deserialize)]
pub struct SshSessionExpirePayload {
    target_id: i32,
    connection_id: String,
}

pub async fn handler(
    State(session_pool): State<Arc<SshSessionPool>>,
    Query(payload): Query<SshSessionExpirePayload>,
) -> Result<(), ApiErr> {
    info!("@ssh_connection {:?}", payload);

    session_pool
        .expire_connection(payload.target_id, payload.connection_id.as_str())
        .await;

    debug!("@sftp_cp done {:?}", payload);
    Ok(())
}
