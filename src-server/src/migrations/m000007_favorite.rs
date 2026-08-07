use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let stmt = Table::create()
            .table(Favorite::Table)
            .if_not_exists()
            .col(pk_auto(Favorite::Id))
            .col(integer(Favorite::TargetId))
            .col(string(Favorite::Name))
            .col(text(Favorite::Path))
            .col(big_integer(Favorite::CreatedAt))
            .index(
                Index::create()
                    .name("idx_favorite_target_path")
                    .table(Favorite::Table)
                    .col(Favorite::TargetId)
                    .col(Favorite::Path)
                    .unique(),
            )
            .to_owned();

        println!("SQL: {}", manager.get_database_backend().build(&stmt));
        manager.create_table(stmt).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Favorite::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum Favorite {
    Table,
    Id,
    TargetId,
    Name,
    Path,
    CreatedAt,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{entities::favorite, migrations::Migrator};
    use sea_orm::{ActiveModelTrait, ActiveValue::Set, Database, EntityTrait};

    #[tokio::test]
    async fn migration_creates_favorite_table_with_unique_location() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, None).await.unwrap();

        let favorite = favorite::ActiveModel {
            id: sea_orm::ActiveValue::NotSet,
            target_id: Set(0),
            name: Set("/tmp".to_string()),
            path: Set("/tmp".to_string()),
            created_at: Set(1),
        };

        favorite.clone().insert(&db).await.unwrap();
        assert!(favorite.insert(&db).await.is_err());
        assert_eq!(favorite::Entity::find().all(&db).await.unwrap().len(), 1);
    }
}
