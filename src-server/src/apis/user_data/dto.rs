use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::entities::target::TargetAuthMethod;

pub const USER_DATA_VERSION: u32 = 1;

#[derive(Debug, Deserialize, Serialize, Clone, ToSchema)]
pub struct UserDataTarget {
    pub id: i32,
    #[serde(default)]
    pub name: String,
    pub host: String,
    pub port: Option<u16>,
    pub method: TargetAuthMethod,
    pub user: String,
    pub key: Option<String>,
    pub password: Option<String>,
    pub system: Option<String>,
    pub jump_host_id: Option<i32>,
}

#[derive(Debug, Deserialize, Serialize, Clone, ToSchema)]
pub struct UserDataFavoriteDirectory {
    pub target_id: i32,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Deserialize, Serialize, Clone, ToSchema)]
pub struct UserDataExport {
    pub version: u32,
    pub exported_at: String,
    pub targets: Vec<UserDataTarget>,
    pub favorite_directories: Vec<UserDataFavoriteDirectory>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UserDataImportPayload {
    pub version: u32,
    pub targets: Vec<UserDataTarget>,
    #[serde(default)]
    pub favorite_directories: Vec<UserDataFavoriteDirectory>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UserDataImportResult {
    pub added_targets: usize,
    pub skipped_targets: usize,
    pub imported_favorites: usize,
}
