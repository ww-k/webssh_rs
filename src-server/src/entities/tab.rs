use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tabs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub key: String,
    pub parent_key: Option<String>,
    pub split_direction: Option<String>,
    pub split_ratio: Option<f64>,
    pub position: i32,
    pub label: Option<String>,
    pub path: Option<String>,
    pub state: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
