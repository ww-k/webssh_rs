use std::{collections::HashMap, sync::Arc};

use axum::{
    Json,
    extract::{Query, State},
};
use tracing::{debug, info};

use crate::{apis::ApiErr, ssh_session_pool::SshSessionPool};

pub async fn handler(
    State(session_pool): State<Arc<SshSessionPool>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<crate::ssh_session_pool::ConnectionInfo>>, ApiErr> {
    info!("@ssh_connection {:?}", params);
    let target_filter = params.get("target_id").and_then(|s| s.parse::<i32>().ok());

    let list = session_pool.list_all_connections(target_filter).await;

    debug!("@sftp_cp done {:?}", params);
    Ok(Json(list))
}
