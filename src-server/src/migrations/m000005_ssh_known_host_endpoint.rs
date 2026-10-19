use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_index(
                Index::create()
                    .name("idx_ssh_known_host_host_port")
                    .table(SshKnownHost::Table)
                    .col(SshKnownHost::Host)
                    .col(SshKnownHost::Port)
                    .unique()
                    .if_not_exists()
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_ssh_known_host_host_port")
                    .table(SshKnownHost::Table)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum SshKnownHost {
    Table,
    Host,
    Port,
}
