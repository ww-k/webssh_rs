use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "favorite_directory_initialization")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub target_id: i32,
    pub initialized_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
