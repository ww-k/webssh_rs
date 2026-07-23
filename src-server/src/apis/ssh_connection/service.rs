use crate::{apis::ssh_connection::dto::ConnectionInfo, ssh_connection_pool::SshConnectionPool};

pub async fn list(
    connection_pool: &SshConnectionPool,
    target_filter: Option<i32>,
) -> Vec<ConnectionInfo> {
    connection_pool
        .connection_snapshots(target_filter)
        .await
        .into_iter()
        .map(ConnectionInfo::from)
        .collect()
}

pub async fn expire(connection_pool: &SshConnectionPool, target_id: i32, connection_id: &str) {
    let _ = connection_pool
        .expire_connection(target_id, connection_id)
        .await;
}
