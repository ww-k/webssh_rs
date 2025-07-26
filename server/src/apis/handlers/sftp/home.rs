use std::sync::Arc;

use axum::extract::{Query, State};
use tracing::{debug, info};

use crate::{
    AppState,
    apis::{
        ApiErr,
        handlers::{QueryTargetId, ssh::exec::exec},
        target::get_target_by_id,
    },
    consts::services_err_code::*,
    map_db_err, map_ssh_err,
};

const WINDOWS: &str = "windows";

pub async fn handler(
    State(state): State<Arc<AppState>>,
    Query(payload): Query<QueryTargetId>,
) -> Result<String, ApiErr> {
    info!("@sftp_home {:?}", payload);

    let target = map_db_err!(get_target_by_id(&state.base_state.db, payload.target_id).await)?;
    let channel = map_ssh_err!(state.session_pool.borrow_channel(payload.target_id).await)?;
    if target.system.as_deref() == Some(WINDOWS) {
        return Ok("/C:".to_string());
    }

    let home_path = exec(channel, "pwd").await?;
    let home_path = home_path.trim().to_string();

    debug!("@sftp_home home_path: {}", home_path);

    Ok(home_path)
}
