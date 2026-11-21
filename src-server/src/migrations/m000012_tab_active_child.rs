use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Tabs::Table)
                    .add_column(string_null(Tabs::ActiveChildKey))
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Tabs::Table)
                    .drop_column(Tabs::ActiveChildKey)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Tabs {
    Table,
    ActiveChildKey,
}
