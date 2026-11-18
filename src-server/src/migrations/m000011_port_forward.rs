use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(PortForward::Table)
                    .if_not_exists()
                    .col(string(PortForward::Id).primary_key())
                    .col(integer(PortForward::TargetId))
                    .col(string(PortForward::LocalHost))
                    .col(integer(PortForward::LocalPort))
                    .col(string(PortForward::RemoteHost))
                    .col(integer(PortForward::RemotePort))
                    .col(boolean(PortForward::Enabled).default(false))
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(PortForward::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum PortForward {
    Table,
    Id,
    TargetId,
    LocalHost,
    LocalPort,
    RemoteHost,
    RemotePort,
    Enabled,
}
