use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(
    Deserialize, Serialize, Clone, Debug, PartialEq, Eq, EnumIter, DeriveActiveEnum, ToSchema,
)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(16))")]
pub enum TransferTaskType {
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
pub enum TransferTaskStatus {
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

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, DeriveEntityModel, ToSchema)]
#[sea_orm(table_name = "transfer_task")]
#[schema(as = TransferTask)]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    #[sea_orm(column_name = "type")]
    pub r#type: TransferTaskType,
    pub status: TransferTaskStatus,
    pub local_path: Option<String>,
    pub target_uri: Option<String>,
    pub target_id: Option<i32>,
    pub name: String,
    pub loaded: i64,
    pub total: i64,
    pub percent: f64,
    pub speed: i64,
    pub estimated_time: Option<i64>,
    pub ranges: String,
    pub fail_reason: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub ended_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
