use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(PortForward::Table)
                    .add_column(string(PortForward::Name).default(""))
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(PortForward::Table)
                    .drop_column(PortForward::Name)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum PortForward {
    Table,
    Name,
}
