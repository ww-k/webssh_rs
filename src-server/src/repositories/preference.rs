use std::collections::HashMap;

use sea_orm::{
    ActiveValue::Set, ColumnTrait, DatabaseConnection, DbErr, EntityTrait, QueryFilter, QueryOrder,
    TransactionTrait,
};

use crate::entities::preference;

pub async fn list(db: &DatabaseConnection) -> Result<Vec<preference::Model>, DbErr> {
    preference::Entity::find()
        .order_by_asc(preference::Column::Key)
        .all(db)
        .await
}

pub async fn replace(
    db: &DatabaseConnection,
    values: HashMap<String, String>,
) -> Result<(), DbErr> {
    let transaction = db.begin().await?;
    preference::Entity::delete_many()
        .filter(preference::Column::Key.not_like("favorite_directory.initialized.%"))
        .exec(&transaction)
        .await?;
    if !values.is_empty() {
        preference::Entity::insert_many(values.into_iter().map(|(key, value)| {
            preference::ActiveModel {
                key: Set(key),
                value: Set(value),
            }
        }))
        .exec_without_returning(&transaction)
        .await?;
    }
    transaction.commit().await
}

pub fn map(values: Vec<preference::Model>) -> HashMap<String, String> {
    values
        .into_iter()
        .map(|model| (model.key, model.value))
        .collect()
}
