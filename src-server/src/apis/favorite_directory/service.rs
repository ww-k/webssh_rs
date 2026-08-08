use std::time::{SystemTime, UNIX_EPOCH};

use sea_orm::{ActiveValue::NotSet, ActiveValue::Set, DatabaseConnection};
use tracing::warn;

use crate::{
    apis::{ApiErr, favorite_directory::dto::FavoriteDirectoryAddPayload, fs, sftp},
    consts::services_err_code::{ERR_CODE_DB_ERR, ERR_CODE_FAVORITE_DIRECTORY_INVALID_REQUEST},
    entities::favorite_directory,
    map_db_err,
    repositories::favorite_directory as favorite_directory_repository,
    ssh_connection_pool::SshConnectionPool,
};

pub async fn list(
    db: &DatabaseConnection,
    connection_pool: &SshConnectionPool,
    target_id: i32,
) -> Result<Vec<favorite_directory::Model>, ApiErr> {
    validate_target_id(target_id)?;
    if !map_db_err!(favorite_directory_repository::is_initialized(db, target_id).await)? {
        let defaults = match discover_default_directories(connection_pool, target_id).await {
            Ok(defaults) => defaults,
            Err(err) => {
                warn!(
                    target_id,
                    error = %err,
                    "failed to discover default favorite directories"
                );
                return stored_list(db, target_id).await;
            }
        };
        let initialized_at = now_ms();
        let defaults = defaults
            .into_iter()
            .map(|(name, path)| favorite_directory::ActiveModel {
                id: NotSet,
                target_id: Set(target_id),
                name: Set(name),
                path: Set(path),
                is_default: Set(true),
                created_at: Set(initialized_at),
            })
            .collect();
        map_db_err!(
            favorite_directory_repository::initialize_defaults(
                db,
                target_id,
                initialized_at,
                defaults,
            )
            .await
        )?;
    }

    stored_list(db, target_id).await
}

async fn stored_list(
    db: &DatabaseConnection,
    target_id: i32,
) -> Result<Vec<favorite_directory::Model>, ApiErr> {
    Ok(map_db_err!(
        favorite_directory_repository::list_by_target(db, target_id).await
    )?)
}

async fn discover_default_directories(
    connection_pool: &SshConnectionPool,
    target_id: i32,
) -> Result<Vec<(String, String)>, ApiErr> {
    if target_id == 0 {
        return Ok(fs::discover_user_dirs()
            .into_iter()
            .map(|dir| (dir.name, dir.path))
            .collect());
    }

    Ok(sftp::discover_user_dirs(connection_pool, target_id)
        .await?
        .into_iter()
        .map(|dir| (dir.name, dir.path))
        .collect())
}

pub async fn add(
    db: &DatabaseConnection,
    payload: FavoriteDirectoryAddPayload,
) -> Result<favorite_directory::Model, ApiErr> {
    validate_target_id(payload.target_id)?;
    validate_text("name", &payload.name)?;
    validate_text("path", &payload.path)?;

    let target_id = payload.target_id;
    let path = payload.path;
    let favorite_directory = favorite_directory::ActiveModel {
        id: NotSet,
        target_id: Set(target_id),
        name: Set(payload.name),
        path: Set(path.clone()),
        is_default: Set(false),
        created_at: Set(now_ms()),
    };
    Ok(map_db_err!(
        favorite_directory_repository::insert_if_absent(db, target_id, &path, favorite_directory)
            .await
    )?)
}

pub async fn remove(db: &DatabaseConnection, target_id: i32, path: &str) -> Result<(), ApiErr> {
    validate_target_id(target_id)?;
    validate_text("path", path)?;
    map_db_err!(favorite_directory_repository::delete_by_location(db, target_id, path).await)?;
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
        code: ERR_CODE_FAVORITE_DIRECTORY_INVALID_REQUEST,
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
    use crate::{
        config::CheckServerKey, migrations::Migrator,
        repositories::favorite_directory as favorite_directory_repository,
    };
    use sea_orm::{ConnectOptions, Database, DatabaseConnection};
    use sea_orm_migration::MigratorTrait;

    async fn test_db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, None).await.unwrap();
        db
    }

    fn connection_pool(db: &DatabaseConnection) -> SshConnectionPool {
        SshConnectionPool::new(db.clone(), CheckServerKey::Disabled, 1, 1)
    }

    #[tokio::test]
    async fn concurrent_adds_return_one_stored_directory() {
        let database_path = std::env::temp_dir().join(format!(
            "webssh-rs-favorite-directory-service-{}.sqlite",
            nanoid::nanoid!()
        ));
        let mut options = ConnectOptions::new(format!(
            "sqlite:{}?mode=rwc",
            database_path.to_string_lossy()
        ));
        options.max_connections(4);
        let db = Database::connect(options).await.unwrap();
        Migrator::up(&db, None).await.unwrap();

        let first = add(
            &db,
            FavoriteDirectoryAddPayload {
                target_id: 0,
                name: "First".to_string(),
                path: "/shared".to_string(),
            },
        );
        let second = add(
            &db,
            FavoriteDirectoryAddPayload {
                target_id: 0,
                name: "Second".to_string(),
                path: "/shared".to_string(),
            },
        );
        let (first, second) = tokio::join!(first, second);
        let first = first.unwrap();
        let second = second.unwrap();

        assert_eq!(first, second);
        assert!(matches!(first.name.as_str(), "First" | "Second"));
        assert!(!first.is_default);
        assert_eq!(
            favorite_directory_repository::list_by_target(&db, 0)
                .await
                .unwrap(),
            vec![first]
        );

        db.close().await.unwrap();
        tokio::fs::remove_file(database_path).await.unwrap();
    }

    #[tokio::test]
    async fn favorite_directories_are_idempotent_and_isolated_by_target() {
        let db = test_db().await;
        let connection_pool = connection_pool(&db);
        favorite_directory_repository::initialize_defaults(&db, 0, 1, Vec::new())
            .await
            .unwrap();
        favorite_directory_repository::initialize_defaults(&db, 1, 1, Vec::new())
            .await
            .unwrap();

        let local = FavoriteDirectoryAddPayload {
            target_id: 0,
            name: "/tmp".to_string(),
            path: "/tmp".to_string(),
        };
        let first = add(&db, local).await.unwrap();
        let duplicate = add(
            &db,
            FavoriteDirectoryAddPayload {
                target_id: 0,
                name: "duplicate name".to_string(),
                path: "/tmp".to_string(),
            },
        )
        .await
        .unwrap();
        add(
            &db,
            FavoriteDirectoryAddPayload {
                target_id: 1,
                name: "/tmp".to_string(),
                path: "/tmp".to_string(),
            },
        )
        .await
        .unwrap();

        assert_eq!(first.id, duplicate.id);
        assert!(!first.is_default);
        assert_eq!(list(&db, &connection_pool, 0).await.unwrap().len(), 1);
        assert_eq!(list(&db, &connection_pool, 1).await.unwrap().len(), 1);

        remove(&db, 0, "/tmp").await.unwrap();
        assert!(list(&db, &connection_pool, 0).await.unwrap().is_empty());
        assert_eq!(list(&db, &connection_pool, 1).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn first_local_list_persists_defaults_only_once() {
        let db = test_db().await;
        let connection_pool = connection_pool(&db);
        let expected = fs::discover_user_dirs();

        let initialized = list(&db, &connection_pool, 0).await.unwrap();
        assert_eq!(initialized.len(), expected.len());
        assert!(initialized.iter().all(|directory| directory.is_default));
        assert_eq!(
            initialized
                .iter()
                .map(|directory| (directory.name.as_str(), directory.path.as_str()))
                .collect::<Vec<_>>(),
            expected
                .iter()
                .map(|directory| (directory.name.as_str(), directory.path.as_str()))
                .collect::<Vec<_>>()
        );

        for directory in initialized {
            remove(&db, 0, &directory.path).await.unwrap();
        }
        assert!(list(&db, &connection_pool, 0).await.unwrap().is_empty());
        assert!(
            favorite_directory_repository::is_initialized(&db, 0)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn default_initialization_preserves_existing_custom_directory() {
        let db = test_db().await;
        let connection_pool = connection_pool(&db);
        let expected = fs::discover_user_dirs();
        let existing_path = expected.first().unwrap().path.clone();
        add(
            &db,
            FavoriteDirectoryAddPayload {
                target_id: 0,
                name: "Custom root".to_string(),
                path: existing_path.clone(),
            },
        )
        .await
        .unwrap();

        let initialized = list(&db, &connection_pool, 0).await.unwrap();
        assert_eq!(initialized.len(), expected.len());
        let existing = initialized
            .iter()
            .find(|directory| directory.path == existing_path)
            .unwrap();
        assert_eq!(existing.name, "Custom root");
        assert!(!existing.is_default);
    }

    #[tokio::test]
    async fn remote_discovery_failure_returns_stored_directories_without_marker() {
        let db = test_db().await;
        let connection_pool = connection_pool(&db);
        let stored = add(
            &db,
            FavoriteDirectoryAddPayload {
                target_id: 999,
                name: "Stored".to_string(),
                path: "/stored".to_string(),
            },
        )
        .await
        .unwrap();

        assert_eq!(
            list(&db, &connection_pool, 999).await.unwrap(),
            vec![stored]
        );
        assert!(
            !favorite_directory_repository::is_initialized(&db, 999)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn favorite_directories_reject_invalid_payloads() {
        let db = test_db().await;
        let connection_pool = connection_pool(&db);

        assert!(list(&db, &connection_pool, -1).await.is_err());
        assert!(
            add(
                &db,
                FavoriteDirectoryAddPayload {
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
