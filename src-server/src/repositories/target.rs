use sea_orm::{ActiveModelTrait, DatabaseConnection, DbErr, DeleteResult, EntityTrait};

use crate::entities::target;

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

pub async fn delete_by_id(db: &DatabaseConnection, id: i32) -> Result<DeleteResult, DbErr> {
    target::Entity::delete_by_id(id).exec(db).await
}

pub async fn find_by_id(
    db: &DatabaseConnection,
    target_id: i32,
) -> Result<Option<target::Model>, DbErr> {
    target::Entity::find_by_id(target_id).one(db).await
}
