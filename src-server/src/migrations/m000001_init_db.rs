use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let target = Table::create()
            .table(Target::Table)
            .if_not_exists()
            .col(pk_auto(Target::Id))
            .col(string(Target::Host))
            .col(small_integer_null(Target::Port))
            .col(tiny_integer(Target::Method))
            .col(string(Target::User))
            .col(text_null(Target::Key))
            .col(string_null(Target::Password))
            .col(string_null(Target::System))
            .to_owned();

        let ssh_known_host = Table::create()
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
            .index(
                Index::create()
                    .name("idx_ssh_known_host_host_port")
                    .table(SshKnownHost::Table)
                    .col(SshKnownHost::Host)
                    .col(SshKnownHost::Port)
                    .unique(),
            )
            .to_owned();

        let transfer_task = Table::create()
            .table(TransferTask::Table)
            .if_not_exists()
            .col(string_len(TransferTask::Id, 32).primary_key())
            .col(string(TransferTask::Type))
            .col(string(TransferTask::Status))
            .col(text_null(TransferTask::LocalPath))
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

        let favorite_directory = Table::create()
            .table(FavoriteDirectory::Table)
            .if_not_exists()
            .col(pk_auto(FavoriteDirectory::Id))
            .col(integer(FavoriteDirectory::TargetId))
            .col(string(FavoriteDirectory::Name))
            .col(text(FavoriteDirectory::Path))
            .col(boolean(FavoriteDirectory::IsDefault))
            .col(big_integer(FavoriteDirectory::CreatedAt))
            .index(
                Index::create()
                    .name("idx_favorite_directory_target_path")
                    .table(FavoriteDirectory::Table)
                    .col(FavoriteDirectory::TargetId)
                    .col(FavoriteDirectory::Path)
                    .unique(),
            )
            .to_owned();

        let favorite_directory_initialization = Table::create()
            .table(FavoriteDirectoryInitialization::Table)
            .if_not_exists()
            .col(integer(FavoriteDirectoryInitialization::TargetId).primary_key())
            .col(big_integer(FavoriteDirectoryInitialization::InitializedAt))
            .to_owned();

        for statement in [
            target,
            ssh_known_host,
            transfer_task,
            favorite_directory,
            favorite_directory_initialization,
        ] {
            println!("SQL: {}", manager.get_database_backend().build(&statement));
            manager.create_table(statement).await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in [
            FavoriteDirectoryInitialization::Table.into_iden(),
            FavoriteDirectory::Table.into_iden(),
            TransferTask::Table.into_iden(),
            SshKnownHost::Table.into_iden(),
            Target::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).to_owned())
                .await?;
        }

        Ok(())
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
    System,
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

#[derive(DeriveIden)]
enum TransferTask {
    Table,
    Id,
    Type,
    Status,
    LocalPath,
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

#[derive(DeriveIden)]
enum FavoriteDirectory {
    Table,
    Id,
    TargetId,
    Name,
    Path,
    IsDefault,
    CreatedAt,
}

#[derive(DeriveIden)]
enum FavoriteDirectoryInitialization {
    Table,
    TargetId,
    InitializedAt,
}

#[cfg(test)]
mod tests {
    use crate::{
        entities::{favorite_directory, favorite_directory_initialization, ssh_known_host},
        migrations::Migrator,
    };
    use sea_orm::{ActiveModelTrait, ActiveValue::Set, Database};

    use super::*;

    fn known_host(host: &str, port: u16, key_algorithm: &str) -> ssh_known_host::ActiveModel {
        ssh_known_host::ActiveModel {
            id: sea_orm::ActiveValue::NotSet,
            host: Set(host.to_string()),
            port: Set(port),
            key_algorithm: Set(key_algorithm.to_string()),
            public_key: Set("public-key".to_string()),
            fingerprint: Set("SHA256:fingerprint".to_string()),
        }
    }

    #[tokio::test]
    async fn init_db_enforces_one_host_key_per_endpoint() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, None).await.unwrap();

        known_host("same-host", 22, "ssh-ed25519")
            .insert(&db)
            .await
            .unwrap();
        assert!(
            known_host("same-host", 22, "ssh-rsa")
                .insert(&db)
                .await
                .is_err()
        );
        known_host("same-host", 2222, "ssh-rsa")
            .insert(&db)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn init_db_enforces_unique_favorite_directory_location() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, None).await.unwrap();

        let favorite_directory = favorite_directory::ActiveModel {
            id: sea_orm::ActiveValue::NotSet,
            target_id: Set(0),
            name: Set("Temp".to_string()),
            path: Set("/tmp".to_string()),
            is_default: Set(false),
            created_at: Set(1),
        };

        favorite_directory.clone().insert(&db).await.unwrap();
        assert!(favorite_directory.insert(&db).await.is_err());
    }

    #[tokio::test]
    async fn init_db_enforces_one_favorite_directory_initialization_per_target() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, None).await.unwrap();

        let initialization = favorite_directory_initialization::ActiveModel {
            target_id: Set(0),
            initialized_at: Set(1),
        };
        initialization.clone().insert(&db).await.unwrap();
        assert!(initialization.insert(&db).await.is_err());
    }
}
