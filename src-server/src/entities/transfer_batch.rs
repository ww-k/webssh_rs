use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(
    Deserialize, Serialize, Clone, Debug, PartialEq, Eq, EnumIter, DeriveActiveEnum, ToSchema,
)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(16))")]
pub enum TransferBatchType {
    #[serde(rename = "UPLOAD")]
    #[sea_orm(string_value = "UPLOAD")]
    Upload,
    #[serde(rename = "DOWNLOAD")]
    #[sea_orm(string_value = "DOWNLOAD")]
    Download,
}

#[derive(
    Deserialize, Serialize, Clone, Debug, PartialEq, Eq, EnumIter, DeriveActiveEnum, ToSchema,
)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(16))")]
pub enum TransferBatchStatus {
    #[serde(rename = "WAIT")]
    #[sea_orm(string_value = "WAIT")]
    Wait,
    #[serde(rename = "RUN")]
    #[sea_orm(string_value = "RUN")]
    Run,
    #[serde(rename = "PAUSE")]
    #[sea_orm(string_value = "PAUSE")]
    Pause,
    #[serde(rename = "SUCCESS")]
    #[sea_orm(string_value = "SUCCESS")]
    Success,
    #[serde(rename = "FAIL")]
    #[sea_orm(string_value = "FAIL")]
    Fail,
    #[serde(rename = "CANCEL")]
    #[sea_orm(string_value = "CANCEL")]
    Cancel,
}

#[derive(
    Copy, Deserialize, Serialize, Clone, Debug, PartialEq, Eq, EnumIter, DeriveActiveEnum, ToSchema,
)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(16))")]
pub enum TransferConflictPolicy {
    #[serde(rename = "OVERWRITE")]
    #[sea_orm(string_value = "OVERWRITE")]
    Overwrite,
    #[serde(rename = "SKIP")]
    #[sea_orm(string_value = "SKIP")]
    Skip,
    #[serde(rename = "RENAME")]
    #[sea_orm(string_value = "RENAME")]
    Rename,
    #[serde(rename = "FAIL")]
    #[sea_orm(string_value = "FAIL")]
    Fail,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, ToSchema)]
pub struct Model {
    pub id: String,
    pub r#type: TransferBatchType,
    pub status: TransferBatchStatus,
    pub name: String,
    pub target_id: Option<i32>,
    pub conflict_policy: TransferConflictPolicy,
    pub item_count: i64,
    pub completed_count: i64,
    pub failed_count: i64,
    pub directory_count: i64,
    pub directory_failed_count: i64,
    pub total: i64,
    pub loaded: i64,
    pub percent: Option<f64>,
    pub speed: i64,
    pub estimated_time: Option<i64>,
    pub fail_reason: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub ended_at: Option<i64>,
}
