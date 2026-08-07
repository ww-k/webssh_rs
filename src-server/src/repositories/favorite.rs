use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, DbErr, DeleteResult, EntityTrait,
    QueryFilter, QueryOrder,
};

use crate::entities::favorite_directory;

pub async fn list_by_target(
    db: &DatabaseConnection,
    target_id: i32,
) -> Result<Vec<favorite_directory::Model>, DbErr> {
    favorite_directory::Entity::find()
        .filter(favorite_directory::Column::TargetId.eq(target_id))
        .order_by_asc(favorite_directory::Column::CreatedAt)
        .order_by_asc(favorite_directory::Column::Id)
        .all(db)
        .await
}

pub async fn find_by_location(
    db: &DatabaseConnection,
    target_id: i32,
    path: &str,
) -> Result<Option<favorite_directory::Model>, DbErr> {
    favorite_directory::Entity::find()
        .filter(favorite_directory::Column::TargetId.eq(target_id))
        .filter(favorite_directory::Column::Path.eq(path))
        .one(db)
        .await
}

pub async fn insert(
    db: &DatabaseConnection,
    active_model: favorite_directory::ActiveModel,
) -> Result<favorite_directory::Model, DbErr> {
    active_model.insert(db).await
}

pub async fn delete_by_location(
    db: &DatabaseConnection,
    target_id: i32,
    path: &str,
) -> Result<DeleteResult, DbErr> {
    favorite_directory::Entity::delete_many()
        .filter(favorite_directory::Column::TargetId.eq(target_id))
        .filter(favorite_directory::Column::Path.eq(path))
        .exec(db)
        .await
}
