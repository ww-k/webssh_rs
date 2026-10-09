use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Target::Table)
                    .add_column(integer_null(Target::JumpHostId))
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Target::Table)
                    .drop_column(Target::JumpHostId)
                    .to_owned(),
            )
            .await
    }
}

#[derive(Iden)]
enum Target {
    Table,
    JumpHostId,
}
