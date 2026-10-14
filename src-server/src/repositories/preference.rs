use sea_orm::{ActiveValue::Set, DatabaseConnection, DbErr, EntityTrait, sea_query::OnConflict};

use crate::entities::preference;

const PREFERENCES_ID: i32 = 1;

pub async fn get(db: &DatabaseConnection) -> Result<Option<String>, DbErr> {
    Ok(preference::Entity::find_by_id(PREFERENCES_ID)
        .one(db)
        .await?
        .map(|model| model.value))
}

pub async fn save(db: &DatabaseConnection, value: String) -> Result<(), DbErr> {
    preference::Entity::insert(preference::ActiveModel {
        id: Set(PREFERENCES_ID),
        value: Set(value),
    })
    .on_conflict(
        OnConflict::column(preference::Column::Id)
            .update_column(preference::Column::Value)
            .to_owned(),
    )
    .exec(db)
    .await?;
    Ok(())
}
