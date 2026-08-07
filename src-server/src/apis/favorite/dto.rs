use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};

#[derive(Deserialize, Debug, IntoParams)]
pub struct FavoriteListQuery {
    /// 本机为 0，SFTP 收藏为对应的目标 ID
    pub target_id: i32,
}

#[derive(Deserialize, Debug, ToSchema)]
pub struct FavoriteAddPayload {
    /// 本机为 0，SFTP 收藏为对应的目标 ID
    pub target_id: i32,
    pub name: String,
    pub path: String,
}

#[derive(Deserialize, Debug, ToSchema)]
pub struct FavoriteRemovePayload {
    /// 本机为 0，SFTP 收藏为对应的目标 ID
    pub target_id: i32,
    pub path: String,
}
