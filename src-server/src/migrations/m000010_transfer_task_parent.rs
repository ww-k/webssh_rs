use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(TransferTask::Table)
                    .add_column(text_null(TransferTask::ParentId))
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_transfer_task_parent_id")
                    .table(TransferTask::Table)
                    .col(TransferTask::ParentId)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_transfer_task_parent_id")
                    .table(TransferTask::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(TransferTask::Table)
                    .drop_column(TransferTask::ParentId)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum TransferTask {
    Table,
    ParentId,
}
