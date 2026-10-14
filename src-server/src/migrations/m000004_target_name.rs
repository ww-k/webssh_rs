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
                    .add_column(string(Target::Name).default(""))
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Target::Table)
                    .drop_column(Target::Name)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Target {
    Table,
    Name,
}
