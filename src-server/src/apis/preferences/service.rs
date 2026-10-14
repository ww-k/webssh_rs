use crate::{
    apis::{ApiErr, preferences::dto::Preferences},
    consts::services_err_code::ERR_CODE_DB_ERR,
    map_db_err,
    repositories::preference as preference_repository,
};
use sea_orm::DatabaseConnection;

pub async fn get(db: &DatabaseConnection) -> Result<Option<Preferences>, ApiErr> {
    let Some(value) = map_db_err!(preference_repository::get(db).await)? else {
        return Ok(None);
    };
    serde_json::from_str(&value)
        .map(Some)
        .map_err(|err| ApiErr {
            code: ERR_CODE_DB_ERR,
            message: format!("invalid stored preferences: {err}"),
        })
}

pub async fn save(db: &DatabaseConnection, preferences: Preferences) -> Result<(), ApiErr> {
    let value = serde_json::to_string(&preferences).map_err(|err| ApiErr {
        code: ERR_CODE_DB_ERR,
        message: err.to_string(),
    })?;
    map_db_err!(preference_repository::save(db, value).await)
}
