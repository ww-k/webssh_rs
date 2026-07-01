use sea_orm_migration::{prelude::*, sea_orm::Statement};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let backend = manager.get_database_backend();

        db.execute(Statement::from_string(
            backend,
            "UPDATE transfer_task SET target_uri = source_uri WHERE type = 'DOWNLOAD' AND target_uri IS NULL".to_string(),
        ))
        .await?;

        let stmt = Table::alter()
            .table(TransferTask::Table)
            .drop_column(TransferTask::SourceUri)
            .to_owned();

        println!("SQL: {}", backend.build(&stmt));
        manager.alter_table(stmt).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let stmt = Table::alter()
            .table(TransferTask::Table)
            .add_column_if_not_exists(ColumnDef::new(TransferTask::SourceUri).text().null())
            .to_owned();

        println!("SQL: {}", manager.get_database_backend().build(&stmt));
        manager.alter_table(stmt).await
    }
}

#[derive(DeriveIden)]
enum TransferTask {
    Table,
    SourceUri,
}
