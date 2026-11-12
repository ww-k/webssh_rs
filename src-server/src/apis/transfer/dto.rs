use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::entities::transfer_task::{
    TransferConflictPolicy, TransferTaskKind, TransferTaskStatus, TransferTaskType,
};

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct TransferRangeSchema(pub i64, pub i64);

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateUploadTaskPayload {
    pub local_path: String,
    pub target_uri: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateDownloadTaskPayload {
    pub source_uri: String,
    pub local_path: Option<String>,
    pub local_dir: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateUploadBatchPayload {
    pub target_uri: String,
    pub sources: Vec<String>,
    pub name: String,
    #[serde(default)]
    pub all: bool,
    #[serde(default)]
    pub conflict_policy: Option<TransferConflictPolicy>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateDownloadBatchPayload {
    pub sources: Vec<String>,
    pub local_dir: String,
    pub name: String,
    #[serde(default)]
    pub all: bool,
    #[serde(default)]
    pub conflict_policy: Option<TransferConflictPolicy>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TransferTaskResponse {
    pub id: String,
    pub r#type: TransferTaskType,
    pub kind: TransferTaskKind,
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
    pub ranges: Vec<TransferRangeSchema>,
    pub fail_reason: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub ended_at: Option<i64>,
    pub batch_id: Option<String>,
    pub parent_id: Option<String>,
    pub relative_path: Option<String>,
    pub conflict_policy: Option<TransferConflictPolicy>,
    pub all: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TransferTaskCountResponse {
    pub count: u64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TransferBatchResponse {
    pub id: String,
}
