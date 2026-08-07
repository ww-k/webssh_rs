use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};

#[derive(Deserialize, Debug, IntoParams)]
pub struct FavoriteDirectoryListQuery {
    /// 本机为 0，SFTP 收藏目录为对应的目标 ID
    pub target_id: i32,
}

#[derive(Deserialize, Debug, ToSchema)]
pub struct FavoriteDirectoryAddPayload {
    /// 本机为 0，SFTP 收藏目录为对应的目标 ID
    pub target_id: i32,
    pub name: String,
    pub path: String,
}

#[derive(Deserialize, Debug, ToSchema)]
pub struct FavoriteDirectoryRemovePayload {
    /// 本机为 0，SFTP 收藏目录为对应的目标 ID
    pub target_id: i32,
    pub path: String,
}
