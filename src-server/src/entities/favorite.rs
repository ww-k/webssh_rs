use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq, DeriveEntityModel, ToSchema)]
#[sea_orm(table_name = "favorite")]
#[schema(as = Favorite)]
pub struct Model {
    #[sea_orm(primary_key)]
    #[serde(skip_deserializing)]
    pub id: i32,
    /// 本机为 0，SFTP 收藏为对应的目标 ID
    pub target_id: i32,
    pub name: String,
    pub path: String,
    pub created_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
