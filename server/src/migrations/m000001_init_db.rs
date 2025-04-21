use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Target::Table)
                    .if_not_exists()
                    .col(pk_auto(Target::Id))
                    .col(string(Target::Host))
                    .col(small_integer(Target::Port))
                    .col(tiny_integer(Target::Method))
                    .col(string(Target::User))
                    .col(text(Target::Key))
                    .col(string(Target::Password))
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Target::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum Target {
    Table,
    Id,
    Host,
    Port,
    Method,
    User,
    Key,
    Password,
}