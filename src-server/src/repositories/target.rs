use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, DbErr, DeleteResult, EntityTrait,
    QueryFilter, TransactionTrait,
};

use crate::entities::{favorite_directory, favorite_directory_initialization, target};

pub async fn list(db: &DatabaseConnection) -> Result<Vec<target::Model>, DbErr> {
    target::Entity::find().all(db).await
}

pub async fn insert(db: &DatabaseConnection, model: target::Model) -> Result<target::Model, DbErr> {
    let mut active_model = target::ActiveModel::from(model);
    active_model.id = sea_orm::ActiveValue::NotSet;
    active_model.insert(db).await
}

pub async fn update(
    db: &DatabaseConnection,
    active_model: target::ActiveModel,
) -> Result<target::Model, DbErr> {
    active_model.update(db).await
}

pub async fn delete_with_favorite_directories(
    db: &DatabaseConnection,
    id: i32,
) -> Result<DeleteResult, DbErr> {
    let transaction = db.begin().await?;
    if id > 0 {
        favorite_directory::Entity::delete_many()
            .filter(favorite_directory::Column::TargetId.eq(id))
            .exec(&transaction)
            .await?;
        favorite_directory_initialization::Entity::delete_by_id(id)
            .exec(&transaction)
            .await?;
    }
    let result = target::Entity::delete_by_id(id).exec(&transaction).await?;
    transaction.commit().await?;
    Ok(result)
}

pub async fn find_by_id(
    db: &DatabaseConnection,
    target_id: i32,
) -> Result<Option<target::Model>, DbErr> {
    target::Entity::find_by_id(target_id).one(db).await
}
