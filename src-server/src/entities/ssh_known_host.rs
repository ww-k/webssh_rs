use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "ssh_known_host")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub host: String,
    pub port: u16,
    pub key_algorithm: String,
    pub public_key: String,
    pub fingerprint: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
