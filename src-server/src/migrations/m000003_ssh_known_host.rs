use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let stmt = Table::create()
            .table(SshKnownHost::Table)
            .if_not_exists()
            .col(pk_auto(SshKnownHost::Id))
            .col(string(SshKnownHost::Host))
            .col(small_unsigned(SshKnownHost::Port))
            .col(string(SshKnownHost::KeyAlgorithm))
            .col(text(SshKnownHost::PublicKey))
            .col(string(SshKnownHost::Fingerprint))
            .index(
                Index::create()
                    .name("idx_ssh_known_host_host_port_algorithm")
                    .table(SshKnownHost::Table)
                    .col(SshKnownHost::Host)
                    .col(SshKnownHost::Port)
                    .col(SshKnownHost::KeyAlgorithm)
                    .unique(),
            )
            .to_owned();

        println!("SQL: {}", manager.get_database_backend().build(&stmt));
        manager.create_table(stmt).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SshKnownHost::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum SshKnownHost {
    Table,
    Id,
    Host,
    Port,
    KeyAlgorithm,
    PublicKey,
    Fingerprint,
}
