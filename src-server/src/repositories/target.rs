use sea_orm::sea_query::Condition;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, DbErr, DeleteResult,
    EntityTrait, QueryFilter, QueryOrder, TransactionTrait,
};

use crate::{
    entities::{favorite_directory, preference, target},
    repositories::favorite_directory::INITIALIZED_KEY_PREFIX,
};

pub async fn list(
    db: &DatabaseConnection,
    keyword: Option<&str>,
) -> Result<Vec<target::Model>, DbErr> {
    let mut query = target::Entity::find();
    if let Some(keyword) = keyword.map(str::trim).filter(|keyword| !keyword.is_empty()) {
        let pattern = format!("%{keyword}%");
        query = query.filter(
            Condition::any()
                .add(target::Column::Name.like(&pattern))
                .add(target::Column::Directory.like(&pattern))
                .add(target::Column::User.like(&pattern))
                .add(target::Column::Host.like(&pattern)),
        );
    }
    query
        .order_by_asc(target::Column::SortOrder)
        .order_by_asc(target::Column::Id)
        .all(db)
        .await
}

pub async fn reorder(db: &DatabaseConnection, ids: &[i32]) -> Result<(), DbErr> {
    let transaction = db.begin().await?;
    for (index, id) in ids.iter().enumerate() {
        target::ActiveModel {
            id: sea_orm::ActiveValue::Unchanged(*id),
            sort_order: sea_orm::ActiveValue::Set(index as i32),
            ..Default::default()
        }
        .update(&transaction)
        .await?;
    }
    transaction.commit().await
}

pub async fn insert(db: &DatabaseConnection, model: target::Model) -> Result<target::Model, DbErr> {
    let mut active_model = target::ActiveModel::from(model);
    active_model.id = sea_orm::ActiveValue::NotSet;
    let next_sort_order = target::Entity::find()
        .all(db)
        .await?
        .into_iter()
        .map(|target| target.sort_order)
        .max()
        .unwrap_or(-1)
        + 1;
    active_model.sort_order = Set(next_sort_order);
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
        preference::Entity::delete_by_id(format!("{INITIALIZED_KEY_PREFIX}{id}"))
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
