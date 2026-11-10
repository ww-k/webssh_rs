use sea_orm::{ConnectionTrait, FromQueryResult, Statement};
use sea_orm_migration::{prelude::*, schema::*};
use serde_json::Value;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Debug, FromQueryResult)]
struct LegacyPreference {
    id: i32,
    value: String,
}

#[derive(Debug, FromQueryResult)]
struct LegacyInitialization {
    target_id: i32,
    initialized_at: i64,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let backend = db.get_database_backend();
        let legacy_preferences = LegacyPreference::find_by_statement(Statement::from_string(
            backend,
            "SELECT id, value FROM preference".to_string(),
        ))
        .all(db)
        .await?;
        let legacy_initializations =
            LegacyInitialization::find_by_statement(Statement::from_string(
                backend,
                "SELECT target_id, initialized_at FROM favorite_directory_initialization"
                    .to_string(),
            ))
            .all(db)
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(Tabs::Table)
                    .if_not_exists()
                    .col(string(Tabs::Key).primary_key())
                    .col(string_null(Tabs::ParentKey))
                    .col(string_null(Tabs::SplitDirection))
                    .col(double_null(Tabs::SplitRatio))
                    .col(integer(Tabs::Position))
                    .col(string_null(Tabs::Label))
                    .col(text_null(Tabs::Path))
                    .col(text_null(Tabs::State))
                    .to_owned(),
            )
            .await?;

        db.execute_unprepared("ALTER TABLE preference RENAME TO preference_legacy")
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(AppState::Table)
                    .if_not_exists()
                    .col(string(AppState::Key).primary_key())
                    .col(text(AppState::Value))
                    .to_owned(),
            )
            .await?;

        if let Some(legacy) = legacy_preferences.into_iter().find(|row| row.id == 1) {
            migrate_preferences(db, &legacy.value).await?;
        }
        for row in legacy_initializations {
            insert_preference(
                db,
                &format!("favorite_directory.initialized.{}", row.target_id),
                &row.initialized_at.to_string(),
            )
            .await?;
        }
        db.execute_unprepared("DROP TABLE preference_legacy")
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(FavoriteDirectoryInitialization::Table)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        manager
            .drop_table(Table::drop().table(Tabs::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(AppState::Table).to_owned())
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(Preference::Table)
                    .if_not_exists()
                    .col(integer(PreferenceLegacy::Id).primary_key())
                    .col(text(PreferenceLegacy::Value))
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(FavoriteDirectoryInitialization::Table)
                    .if_not_exists()
                    .col(integer(FavoriteDirectoryInitialization::TargetId).primary_key())
                    .col(big_integer(FavoriteDirectoryInitialization::InitializedAt))
                    .to_owned(),
            )
            .await?;
        let _ = db;
        Ok(())
    }
}

async fn insert_preference<C: ConnectionTrait>(
    db: &C,
    key: &str,
    value: &str,
) -> Result<(), DbErr> {
    db.execute(Statement::from_sql_and_values(
        db.get_database_backend(),
        "INSERT INTO app_state (key, value) VALUES (?, ?)",
        [key.into(), value.into()],
    ))
    .await
    .map(|_| ())
}

async fn migrate_preferences<C: ConnectionTrait>(db: &C, raw: &str) -> Result<(), DbErr> {
    let root: Value = serde_json::from_str(raw)
        .map_err(|err| DbErr::Custom(format!("invalid stored preferences: {err}")))?;
    if let Some(active) = root.get("active_tab_key").and_then(Value::as_str) {
        insert_preference(db, "active_tab_key", active).await?;
    }
    if let Some(settings) = root.get("settings").and_then(Value::as_object) {
        for (key, value) in settings {
            insert_preference(db, &format!("settings.{key}"), &value.to_string()).await?;
        }
    }
    if let Some(tabs) = root.get("tabs").and_then(Value::as_array) {
        for (position, tab) in tabs.iter().enumerate() {
            let Some(key) = tab.get("key").and_then(Value::as_str) else {
                continue;
            };
            let label = tab.get("label").and_then(Value::as_str);
            let path = tab.get("path").and_then(Value::as_str);
            let state = tab.get("state").map(Value::to_string);
            let statement = Statement::from_sql_and_values(
                db.get_database_backend(),
                "INSERT INTO tabs (key, parent_key, split_direction, split_ratio, position, label, path, state) VALUES (?, NULL, NULL, NULL, ?, ?, ?, ?)",
                [
                    key.into(),
                    (position as i32).into(),
                    label.into(),
                    path.into(),
                    state.into(),
                ],
            );
            db.execute(statement).await?;
        }
    }
    Ok(())
}

#[derive(DeriveIden)]
enum AppState {
    Table,
    Key,
    Value,
}
#[derive(DeriveIden)]
enum Preference {
    Table,
}
#[derive(DeriveIden)]
enum PreferenceLegacy {
    Id,
    Value,
}
#[derive(DeriveIden)]
enum Tabs {
    Table,
    Key,
    ParentKey,
    SplitDirection,
    SplitRatio,
    Position,
    Label,
    Path,
    State,
}
#[derive(DeriveIden)]
enum FavoriteDirectoryInitialization {
    Table,
    TargetId,
    InitializedAt,
}
