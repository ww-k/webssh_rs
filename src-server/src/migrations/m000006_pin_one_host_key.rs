use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                r#"
                DELETE FROM "ssh_known_host"
                WHERE "id" NOT IN (
                    SELECT MIN("id")
                    FROM "ssh_known_host"
                    GROUP BY "host", "port"
                )
                "#,
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_ssh_known_host_host_port")
                    .table(SshKnownHost::Table)
                    .col(SshKnownHost::Host)
                    .col(SshKnownHost::Port)
                    .unique()
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{entities::ssh_known_host, migrations::Migrator};
    use sea_orm::{ActiveModelTrait, ActiveValue::Set, Database, EntityTrait, QueryOrder};

    fn known_host(
        host: &str,
        port: u16,
        key_algorithm: &str,
        public_key: &str,
    ) -> ssh_known_host::ActiveModel {
        ssh_known_host::ActiveModel {
            id: sea_orm::ActiveValue::NotSet,
            host: Set(host.to_string()),
            port: Set(port),
            key_algorithm: Set(key_algorithm.to_string()),
            public_key: Set(public_key.to_string()),
            fingerprint: Set(format!("SHA256:{public_key}")),
        }
    }

    #[tokio::test]
    async fn migration_keeps_the_oldest_key_and_pins_one_key_per_endpoint() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, Some(5)).await.unwrap();

        known_host("same-host", 22, "ssh-ed25519", "oldest")
            .insert(&db)
            .await
            .unwrap();
        known_host("same-host", 22, "ecdsa-sha2-nistp256", "newer")
            .insert(&db)
            .await
            .unwrap();
        known_host("same-host", 2222, "ssh-ed25519", "other-port")
            .insert(&db)
            .await
            .unwrap();

        Migrator::up(&db, Some(1)).await.unwrap();

        let stored = ssh_known_host::Entity::find()
            .order_by_asc(ssh_known_host::Column::Id)
            .all(&db)
            .await
            .unwrap();
        assert_eq!(stored.len(), 2);
        assert_eq!(stored[0].public_key, "oldest");
        assert_eq!(stored[1].public_key, "other-port");

        let conflicting = known_host("same-host", 22, "ssh-rsa", "conflicting")
            .insert(&db)
            .await;
        assert!(conflicting.is_err());

        Migrator::down(&db, Some(1)).await.unwrap();
        known_host("same-host", 22, "ssh-rsa", "allowed-after-down")
            .insert(&db)
            .await
            .unwrap();
    }
}
