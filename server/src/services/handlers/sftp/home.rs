use std::sync::Arc;

use axum::extract::{Query, State};
use tracing::{debug, info};

use crate::{
    consts::services_err_code::*,
    map_db_err, map_ssh_err,
    services::{
        ApiErr,
        handlers::{QueryTargetId, ssh_exec},
        target::get_target_by_id,
    },
};

use super::AppStateWrapper;

const WINDOWS: &str = "windows";

pub async fn handler(
    State(state): State<Arc<AppStateWrapper>>,
    Query(payload): Query<QueryTargetId>,
) -> Result<String, ApiErr> {
    info!("@sftp_home {:?}", payload);

    let target = map_db_err!(get_target_by_id(&state.app_state.db, payload.target_id).await)?;
    let channel = map_ssh_err!(state.session_pool.get(payload.target_id).await)?;
    if target.system.as_deref() == Some(WINDOWS) {
        return Ok("/C:".to_string());
    }

    let home_path = ssh_exec::exec(channel, "pwd").await?;
    let home_path = home_path.trim().to_string();

    debug!("@sftp_home home_path: {}", home_path);

    Ok(home_path)
}
