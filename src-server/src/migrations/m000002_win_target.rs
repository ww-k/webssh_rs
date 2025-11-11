use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let stmt = Table::alter()
            .table(Target::Table)
            .add_column_if_not_exists(string_null(Target::System))
            .to_owned();

        println!("SQL: {}", manager.get_database_backend().build(&stmt));
        manager.alter_table(stmt).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let stmt = Table::alter()
            .table(Target::Table)
            .drop_column(Alias::new("system"))
            .to_owned();

        println!("SQL: {}", manager.get_database_backend().build(&stmt));
        manager.alter_table(stmt).await
    }
}

#[derive(DeriveIden)]
enum Target {
    Table,
    System,
}
