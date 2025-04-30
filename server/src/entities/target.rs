use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TargetAuthMethod {
    Password = 1,
    PrivateKey = 2,
    None = 3,
    // HostBased,
    // HostBased,
    // KeyboardInteractive,
}

#[derive(Deserialize, Serialize)]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "target")]
pub struct Model {
    #[sea_orm(primary_key)]
    #[serde(skip_deserializing)]
    id: i32,
    host: String,
    port: Option<u16>,
    method: u8,
    user: String,
    key: Option<String>,
    password: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
}

impl ActiveModelBehavior for ActiveModel {}
