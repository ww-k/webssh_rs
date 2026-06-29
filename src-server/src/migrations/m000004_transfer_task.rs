use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let stmt = Table::create()
            .table(TransferTask::Table)
            .if_not_exists()
            .col(string_len(TransferTask::Id, 32).primary_key())
            .col(string(TransferTask::Type))
            .col(string(TransferTask::Status))
            .col(text_null(TransferTask::LocalPath))
            .col(text_null(TransferTask::SourceUri))
            .col(text_null(TransferTask::TargetUri))
            .col(integer_null(TransferTask::TargetId))
            .col(string(TransferTask::Name))
            .col(big_integer(TransferTask::Loaded))
            .col(big_integer(TransferTask::Total))
            .col(double(TransferTask::Percent))
            .col(big_integer(TransferTask::Speed))
            .col(big_integer_null(TransferTask::EstimatedTime))
            .col(text(TransferTask::Ranges))
            .col(text_null(TransferTask::FailReason))
            .col(big_integer(TransferTask::CreatedAt))
            .col(big_integer(TransferTask::UpdatedAt))
            .col(big_integer_null(TransferTask::EndedAt))
            .to_owned();

        println!("SQL: {}", manager.get_database_backend().build(&stmt));
        manager.create_table(stmt).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(TransferTask::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum TransferTask {
    Table,
    Id,
    Type,
    Status,
    LocalPath,
    SourceUri,
    TargetUri,
    TargetId,
    Name,
    Loaded,
    Total,
    Percent,
    Speed,
    EstimatedTime,
    Ranges,
    FailReason,
    CreatedAt,
    UpdatedAt,
    EndedAt,
}
