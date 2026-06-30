use crate::ssh_session_pool::{ConnectionInfo, SshSessionPool};

pub async fn list(
    session_pool: &SshSessionPool,
    target_filter: Option<i32>,
) -> Vec<ConnectionInfo> {
    session_pool.list_all_connections(target_filter).await
}

pub async fn expire(session_pool: &SshSessionPool, target_id: i32, connection_id: &str) {
    session_pool
        .expire_connection(target_id, connection_id)
        .await;
}
