use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct PortForwardInfo {
    pub id: String,
    pub name: String,
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub target_id: i32,
    pub enabled: bool,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct PortForwardPayload {
    pub name: String,
    pub target_id: i32,
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct PortForwardUpdatePayload {
    pub id: String,
    pub name: String,
    pub target_id: i32,
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct PortForwardRemovePayload {
    pub id: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct PortForwardTogglePayload {
    pub id: String,
    pub enabled: bool,
}
