use std::time::{SystemTime, UNIX_EPOCH};

use sea_orm::{ActiveValue::NotSet, ActiveValue::Set, DatabaseConnection};

use crate::{
    apis::{ApiErr, favorite::dto::FavoriteAddPayload},
    consts::services_err_code::{ERR_CODE_DB_ERR, ERR_CODE_FAVORITE_INVALID_REQUEST},
    entities::favorite_directory,
    map_db_err,
    repositories::favorite as favorite_repository,
};

pub async fn list(
    db: &DatabaseConnection,
    target_id: i32,
) -> Result<Vec<favorite_directory::Model>, ApiErr> {
    validate_target_id(target_id)?;
    Ok(map_db_err!(
        favorite_repository::list_by_target(db, target_id).await
    )?)
}

pub async fn add(
    db: &DatabaseConnection,
    payload: FavoriteAddPayload,
) -> Result<favorite_directory::Model, ApiErr> {
    validate_target_id(payload.target_id)?;
    validate_text("name", &payload.name)?;
    validate_text("path", &payload.path)?;

    if let Some(stored) = map_db_err!(
        favorite_repository::find_by_location(db, payload.target_id, &payload.path).await
    )? {
        return Ok(stored);
    }

    let favorite = favorite_directory::ActiveModel {
        id: NotSet,
        target_id: Set(payload.target_id),
        name: Set(payload.name),
        path: Set(payload.path),
        created_at: Set(now_ms()),
    };
    Ok(map_db_err!(
        favorite_repository::insert(db, favorite).await
    )?)
}

pub async fn remove(db: &DatabaseConnection, target_id: i32, path: &str) -> Result<(), ApiErr> {
    validate_target_id(target_id)?;
    validate_text("path", path)?;
    map_db_err!(favorite_repository::delete_by_location(db, target_id, path).await)?;
    Ok(())
}

fn validate_target_id(target_id: i32) -> Result<(), ApiErr> {
    if target_id < 0 {
        return Err(invalid_request(
            "target_id must be greater than or equal to 0",
        ));
    }
    Ok(())
}

fn validate_text(field: &str, value: &str) -> Result<(), ApiErr> {
    if value.is_empty() {
        return Err(invalid_request(&format!("{field} must not be empty")));
    }
    Ok(())
}

fn invalid_request(message: &str) -> ApiErr {
    ApiErr {
        code: ERR_CODE_FAVORITE_INVALID_REQUEST,
        message: message.to_string(),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{apis::favorite::dto::FavoriteAddPayload, migrations::Migrator};
    use sea_orm::Database;
    use sea_orm_migration::MigratorTrait;

    #[tokio::test]
    async fn favorites_are_idempotent_and_isolated_by_target() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, None).await.unwrap();

        let local = FavoriteAddPayload {
            target_id: 0,
            name: "/tmp".to_string(),
            path: "/tmp".to_string(),
        };
        let first = add(&db, local).await.unwrap();
        let duplicate = add(
            &db,
            FavoriteAddPayload {
                target_id: 0,
                name: "duplicate name".to_string(),
                path: "/tmp".to_string(),
            },
        )
        .await
        .unwrap();
        add(
            &db,
            FavoriteAddPayload {
                target_id: 1,
                name: "/tmp".to_string(),
                path: "/tmp".to_string(),
            },
        )
        .await
        .unwrap();

        assert_eq!(first.id, duplicate.id);
        assert_eq!(list(&db, 0).await.unwrap().len(), 1);
        assert_eq!(list(&db, 1).await.unwrap().len(), 1);

        remove(&db, 0, "/tmp").await.unwrap();
        assert!(list(&db, 0).await.unwrap().is_empty());
        assert_eq!(list(&db, 1).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn favorites_reject_invalid_payloads() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, None).await.unwrap();

        assert!(list(&db, -1).await.is_err());
        assert!(
            add(
                &db,
                FavoriteAddPayload {
                    target_id: 0,
                    name: "/tmp".to_string(),
                    path: "".to_string(),
                },
            )
            .await
            .is_err()
        );
    }
}
