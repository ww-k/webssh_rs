use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::entities::target::TargetAuthMethod;

pub const USER_DATA_VERSION: u32 = 1;

#[derive(Debug, Deserialize, Serialize, Clone, ToSchema)]
pub struct UserDataTarget {
    pub id: i32,
    #[serde(default)]
    pub sort_order: i32,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub directory: String,
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

#[derive(Debug, Deserialize, ToSchema)]
pub struct UserDataExportPayload {
    pub password: Option<String>,
    pub settings: Value,
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct EncryptedUserDataExport {
    pub version: u32,
    pub algorithm: String,
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UserDataImportPayload {
    pub password: Option<String>,
    pub data: Value,
    #[serde(default = "default_true")]
    pub import_settings: bool,
    #[serde(default = "default_true")]
    pub import_targets: bool,
    #[serde(default = "default_true")]
    pub import_favorites: bool,
    #[serde(default)]
    pub target_conflict: TargetConflict,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UserDataImportUrlPayload {
    pub password: Option<String>,
    pub url: String,
    #[serde(default = "default_true")]
    pub import_settings: bool,
    #[serde(default = "default_true")]
    pub import_targets: bool,
    #[serde(default = "default_true")]
    pub import_favorites: bool,
    #[serde(default)]
    pub target_conflict: TargetConflict,
}

#[derive(Debug, Deserialize, Clone, Copy, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TargetConflict {
    Skip,
    Overwrite,
}

impl Default for TargetConflict {
    fn default() -> Self {
        Self::Overwrite
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct UserDataDocument {
    pub version: u32,
    pub exported_at: String,
    pub targets: Vec<UserDataTarget>,
    pub favorite_directories: Vec<UserDataFavoriteDirectory>,
    #[serde(default)]
    pub settings: Value,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UserDataImportResult {
    pub added_targets: usize,
    pub updated_targets: usize,
    pub skipped_targets: usize,
    pub imported_favorites: usize,
    pub settings: Value,
}
