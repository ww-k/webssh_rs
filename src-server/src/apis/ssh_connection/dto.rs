use serde::Deserialize;

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct SshSessionExpirePayload {
    /// SSH 目标 ID
    pub target_id: i32,
    /// 要过期的连接 ID
    pub connection_id: String,
}
