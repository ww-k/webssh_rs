use serde::{Deserialize, Serialize};

use crate::ssh_connection_pool::{ConnectionSnapshot, ConnectionState};

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct SshConnectionExpirePayload {
    /// SSH 目标 ID
    pub target_id: i32,
    /// 要过期的连接 ID
    pub connection_id: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ConnectionInfo {
    /// SSH 连接 ID
    pub id: String,
    /// 连接是否已过期
    pub expired: bool,
    /// 连接是否已关闭
    pub closed: bool,
    /// 关联的 SSH 目标 ID
    pub target_id: i32,
    /// Current active channel count
    pub active_channels: usize,
}

impl From<ConnectionSnapshot> for ConnectionInfo {
    fn from(snapshot: ConnectionSnapshot) -> Self {
        Self {
            id: snapshot.id,
            expired: snapshot.state != ConnectionState::Active,
            closed: snapshot.state == ConnectionState::Closed,
            target_id: snapshot.target_id,
            active_channels: snapshot.active_channels,
        }
    }
}
