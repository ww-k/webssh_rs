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
    /// 连接类型名称
    pub type_name: String,
    /// 关联的 SSH 目标 ID
    pub target_id: i32,
}

impl From<ConnectionSnapshot> for ConnectionInfo {
    fn from(snapshot: ConnectionSnapshot) -> Self {
        Self {
            id: snapshot.id,
            expired: snapshot.state != ConnectionState::Active,
            closed: snapshot.state == ConnectionState::Closed,
            type_name: "SSH".to_string(),
            target_id: snapshot.target_id,
        }
    }
}
