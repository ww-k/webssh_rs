use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Target::Table)
                    .add_column(string(Target::Directory).default(""))
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Target::Table)
                    .drop_column(Target::Directory)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Target {
    Table,
    Directory,
}
