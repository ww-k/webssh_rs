use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, DbErr, DeleteResult, EntityTrait,
    QueryFilter, QueryOrder,
};

use crate::entities::favorite;

pub async fn list_by_target(
    db: &DatabaseConnection,
    target_id: i32,
) -> Result<Vec<favorite::Model>, DbErr> {
    favorite::Entity::find()
        .filter(favorite::Column::TargetId.eq(target_id))
        .order_by_asc(favorite::Column::CreatedAt)
        .order_by_asc(favorite::Column::Id)
        .all(db)
        .await
}

pub async fn find_by_location(
    db: &DatabaseConnection,
    target_id: i32,
    path: &str,
) -> Result<Option<favorite::Model>, DbErr> {
    favorite::Entity::find()
        .filter(favorite::Column::TargetId.eq(target_id))
        .filter(favorite::Column::Path.eq(path))
        .one(db)
        .await
}

pub async fn insert(
    db: &DatabaseConnection,
    active_model: favorite::ActiveModel,
) -> Result<favorite::Model, DbErr> {
    active_model.insert(db).await
}

pub async fn delete_by_location(
    db: &DatabaseConnection,
    target_id: i32,
    path: &str,
) -> Result<DeleteResult, DbErr> {
    favorite::Entity::delete_many()
        .filter(favorite::Column::TargetId.eq(target_id))
        .filter(favorite::Column::Path.eq(path))
        .exec(db)
        .await
}
