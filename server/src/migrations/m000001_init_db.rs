use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let stmt = Table::create()
            .table(Target::Table)
            .if_not_exists()
            .col(pk_auto(Target::Id))
            .col(string(Target::Host))
            .col(small_integer_null(Target::Port))
            .col(tiny_integer(Target::Method))
            .col(string(Target::User))
            .col(text_null(Target::Key))
            .col(string_null(Target::Password))
            .to_owned();

        println!("SQL: {}", manager.get_database_backend().build(&stmt));
        manager.create_table(stmt).await
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
