use serde::Deserialize;

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SshKnownHostRemovePayload {
    /// 要删除的 SSH 主机密钥记录 ID
    pub id: i32,
}
