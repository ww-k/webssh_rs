use sea_orm::{
    ActiveValue::Set, DatabaseConnection, DbErr, EntityTrait, QueryOrder, TransactionTrait,
};

use crate::entities::tab;

pub async fn list(db: &DatabaseConnection) -> Result<Vec<tab::Model>, DbErr> {
    tab::Entity::find()
        .order_by_asc(tab::Column::Position)
        .all(db)
        .await
}

pub async fn replace(db: &DatabaseConnection, models: Vec<tab::ActiveModel>) -> Result<(), DbErr> {
    let transaction = db.begin().await?;
    tab::Entity::delete_many().exec(&transaction).await?;
    if !models.is_empty() {
        tab::Entity::insert_many(models)
            .exec_without_returning(&transaction)
            .await?;
    }
    transaction.commit().await
}

pub fn from_preference_with_layout(
    model: crate::apis::preferences::dto::PreferenceTab,
    position: i32,
) -> tab::ActiveModel {
    tab::ActiveModel {
        key: Set(model.key),
        parent_key: Set(model.parent_key),
        split_direction: Set(model.split_direction),
        split_ratio: Set(model.split_ratio),
        position: Set(model.position.unwrap_or(position)),
        label: Set(model.label),
        path: Set(model.path),
        state: Set(model.state.map(|value| value.to_string())),
    }
}
