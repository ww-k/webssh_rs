use sea_orm::{
    ActiveValue::Set, ColumnTrait, ConnectionTrait, DatabaseConnection, DbErr, DeleteResult,
    EntityTrait, QueryFilter, QueryOrder, TransactionTrait, TryInsertResult, sea_query::OnConflict,
};

use crate::entities::{favorite_directory, favorite_directory_initialization};

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

pub async fn find_by_location<C>(
    db: &C,
    target_id: i32,
    path: &str,
) -> Result<Option<favorite_directory::Model>, DbErr>
where
    C: ConnectionTrait,
{
    favorite_directory::Entity::find()
        .filter(favorite_directory::Column::TargetId.eq(target_id))
        .filter(favorite_directory::Column::Path.eq(path))
        .one(db)
        .await
}

pub async fn insert_if_absent(
    db: &DatabaseConnection,
    target_id: i32,
    path: &str,
    active_model: favorite_directory::ActiveModel,
) -> Result<favorite_directory::Model, DbErr> {
    let transaction = db.begin().await?;
    favorite_directory::Entity::insert(active_model)
        .on_conflict(
            OnConflict::columns([
                favorite_directory::Column::TargetId,
                favorite_directory::Column::Path,
            ])
            .do_nothing()
            .to_owned(),
        )
        .do_nothing()
        .exec_without_returning(&transaction)
        .await?;
    let stored = find_by_location(&transaction, target_id, path)
        .await?
        .ok_or_else(|| DbErr::RecordNotFound("favorite directory was not stored".to_string()))?;
    transaction.commit().await?;
    Ok(stored)
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

pub async fn is_initialized<C>(db: &C, target_id: i32) -> Result<bool, DbErr>
where
    C: ConnectionTrait,
{
    Ok(
        favorite_directory_initialization::Entity::find_by_id(target_id)
            .one(db)
            .await?
            .is_some(),
    )
}

pub async fn initialize_defaults(
    db: &DatabaseConnection,
    target_id: i32,
    initialized_at: i64,
    defaults: Vec<favorite_directory::ActiveModel>,
) -> Result<bool, DbErr> {
    let transaction = db.begin().await?;
    let marker = favorite_directory_initialization::ActiveModel {
        target_id: Set(target_id),
        initialized_at: Set(initialized_at),
    };
    let marker_result = favorite_directory_initialization::Entity::insert(marker)
        .on_conflict(
            OnConflict::column(favorite_directory_initialization::Column::TargetId)
                .do_nothing()
                .to_owned(),
        )
        .do_nothing()
        .exec_without_returning(&transaction)
        .await?;
    let won = matches!(marker_result, TryInsertResult::Inserted(rows) if rows > 0);

    if won && !defaults.is_empty() {
        favorite_directory::Entity::insert_many(defaults)
            .on_conflict(
                OnConflict::columns([
                    favorite_directory::Column::TargetId,
                    favorite_directory::Column::Path,
                ])
                .do_nothing()
                .to_owned(),
            )
            .do_nothing()
            .exec_without_returning(&transaction)
            .await?;
    }

    transaction.commit().await?;
    Ok(won)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use sea_orm::{ActiveValue::NotSet, ConnectOptions, Database};
    use sea_orm_migration::MigratorTrait;

    use crate::migrations::Migrator;

    use super::*;

    fn directory(path: &str, name: &str, is_default: bool) -> favorite_directory::ActiveModel {
        favorite_directory::ActiveModel {
            id: NotSet,
            target_id: Set(0),
            name: Set(name.to_string()),
            path: Set(path.to_string()),
            is_default: Set(is_default),
            created_at: Set(1),
        }
    }

    fn default_directory(path: &str) -> favorite_directory::ActiveModel {
        directory(path, "Home", true)
    }

    async fn file_test_db() -> (DatabaseConnection, PathBuf) {
        let database_path = std::env::temp_dir().join(format!(
            "webssh-rs-favorite-directory-{}.sqlite",
            nanoid::nanoid!()
        ));
        let mut options = ConnectOptions::new(format!(
            "sqlite:{}?mode=rwc",
            database_path.to_string_lossy()
        ));
        options.max_connections(4);
        let db = Database::connect(options).await.unwrap();
        Migrator::up(&db, None).await.unwrap();
        (db, database_path)
    }

    async fn close_file_test_db(db: DatabaseConnection, database_path: PathBuf) {
        db.close().await.unwrap();
        tokio::fs::remove_file(database_path).await.unwrap();
    }

    #[tokio::test]
    async fn concurrent_default_initialization_has_one_winner() {
        let (db, database_path) = file_test_db().await;

        let first = initialize_defaults(&db, 0, 1, vec![default_directory("/home/test")]);
        let second = initialize_defaults(&db, 0, 2, vec![default_directory("/home/test")]);
        let (first, second) = tokio::join!(first, second);

        assert_eq!(u8::from(first.unwrap()) + u8::from(second.unwrap()), 1);
        assert!(is_initialized(&db, 0).await.unwrap());
        assert_eq!(list_by_target(&db, 0).await.unwrap().len(), 1);

        close_file_test_db(db, database_path).await;
    }

    #[tokio::test]
    async fn concurrent_inserts_return_the_same_stored_directory() {
        let (db, database_path) = file_test_db().await;

        let first = insert_if_absent(&db, 0, "/shared", directory("/shared", "First", false));
        let second = insert_if_absent(&db, 0, "/shared", directory("/shared", "Second", false));
        let (first, second) = tokio::join!(first, second);
        let first = first.unwrap();
        let second = second.unwrap();

        assert_eq!(first, second);
        assert!(matches!(first.name.as_str(), "First" | "Second"));
        assert!(!first.is_default);
        assert_eq!(list_by_target(&db, 0).await.unwrap(), vec![first]);

        close_file_test_db(db, database_path).await;
    }

    #[tokio::test]
    async fn manual_insert_racing_with_default_initialization_preserves_the_winner() {
        let (db, database_path) = file_test_db().await;

        let manual = insert_if_absent(
            &db,
            0,
            "/home/test",
            directory("/home/test", "Manual", false),
        );
        let defaults = initialize_defaults(&db, 0, 1, vec![default_directory("/home/test")]);
        let (manual, defaults) = tokio::join!(manual, defaults);
        let manual = manual.unwrap();
        defaults.unwrap();

        let stored = list_by_target(&db, 0).await.unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(manual, stored[0]);
        assert!(
            (manual.name == "Manual" && !manual.is_default)
                || (manual.name == "Home" && manual.is_default)
        );
        assert!(is_initialized(&db, 0).await.unwrap());

        close_file_test_db(db, database_path).await;
    }

    #[tokio::test]
    async fn failed_default_insert_rolls_back_initialization_marker() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, None).await.unwrap();
        let mut invalid = default_directory("/home/test");
        invalid.path = NotSet;

        assert!(initialize_defaults(&db, 0, 1, vec![invalid]).await.is_err());
        assert!(!is_initialized(&db, 0).await.unwrap());
    }
}
