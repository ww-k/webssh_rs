use sea_orm::{
    ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    sea_query::OnConflict,
};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::{config::CheckServerKey, entities::ssh_known_host};

use super::error::{SshPoolError, SshPoolResult};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ServerPublicKey {
    pub(crate) key_algorithm: String,
    pub(crate) public_key: String,
    pub(crate) fingerprint: String,
}

#[derive(Clone)]
pub(crate) struct KnownHosts {
    db: DatabaseConnection,
    policy: CheckServerKey,
    accept_new_lock: Arc<Mutex<()>>,
}

impl KnownHosts {
    pub(crate) fn new(db: DatabaseConnection, policy: CheckServerKey) -> Self {
        Self {
            db,
            policy,
            accept_new_lock: Arc::new(Mutex::new(())),
        }
    }

    pub(crate) fn policy(&self) -> CheckServerKey {
        self.policy
    }

    pub(crate) async fn load(&self, host: &str, port: u16) -> SshPoolResult<Vec<ServerPublicKey>> {
        let known_hosts = ssh_known_host::Entity::find()
            .filter(ssh_known_host::Column::Host.eq(host))
            .filter(ssh_known_host::Column::Port.eq(port))
            .all(&self.db)
            .await?;

        Ok(known_hosts
            .into_iter()
            .map(|known_host| ServerPublicKey {
                key_algorithm: known_host.key_algorithm,
                public_key: known_host.public_key,
                fingerprint: known_host.fingerprint,
            })
            .collect())
    }

    pub(crate) async fn remember_accept_new(
        &self,
        host: &str,
        port: u16,
        observed: ServerPublicKey,
    ) -> SshPoolResult<()> {
        if self.policy != CheckServerKey::AcceptNew {
            return Ok(());
        }

        let _guard = self.accept_new_lock.lock().await;
        let stored_keys = self.load(host, port).await?;
        if stored_keys.iter().any(|key| {
            key.key_algorithm == observed.key_algorithm && key.public_key == observed.public_key
        }) {
            return Ok(());
        }
        if !stored_keys.is_empty() {
            return Err(SshPoolError::HostKeyMismatch {
                host: host.to_string(),
                port,
                expected_fingerprints: stored_keys.into_iter().map(|key| key.fingerprint).collect(),
                actual_fingerprint: observed.fingerprint,
            });
        }

        let active_model = ssh_known_host::ActiveModel {
            id: sea_orm::ActiveValue::NotSet,
            host: Set(host.to_string()),
            port: Set(port),
            key_algorithm: Set(observed.key_algorithm.clone()),
            public_key: Set(observed.public_key.clone()),
            fingerprint: Set(observed.fingerprint.clone()),
        };

        ssh_known_host::Entity::insert(active_model)
            .on_conflict(
                OnConflict::columns([ssh_known_host::Column::Host, ssh_known_host::Column::Port])
                    .do_nothing()
                    .to_owned(),
            )
            .do_nothing()
            .exec_without_returning(&self.db)
            .await?;

        let stored_keys = self.load(host, port).await?;
        if !stored_keys.iter().any(|key| {
            key.key_algorithm == observed.key_algorithm && key.public_key == observed.public_key
        }) {
            return Err(SshPoolError::HostKeyMismatch {
                host: host.to_string(),
                port,
                expected_fingerprints: stored_keys.into_iter().map(|key| key.fingerprint).collect(),
                actual_fingerprint: observed.fingerprint,
            });
        }

        Ok(())
    }
}

pub(crate) fn verify_server_key(
    policy: CheckServerKey,
    host: &str,
    port: u16,
    pinned: &[ServerPublicKey],
    observed: &ServerPublicKey,
) -> SshPoolResult<()> {
    if policy == CheckServerKey::Disabled {
        return Ok(());
    }

    if pinned.iter().any(|key| {
        key.key_algorithm == observed.key_algorithm && key.public_key == observed.public_key
    }) {
        return Ok(());
    }

    if policy == CheckServerKey::AcceptNew && pinned.is_empty() {
        return Ok(());
    }

    if pinned.is_empty() {
        return Err(SshPoolError::HostKeyUnknown {
            host: host.to_string(),
            port,
            fingerprint: observed.fingerprint.clone(),
        });
    }

    Err(SshPoolError::HostKeyMismatch {
        host: host.to_string(),
        port,
        expected_fingerprints: pinned.iter().map(|key| key.fingerprint.clone()).collect(),
        actual_fingerprint: observed.fingerprint.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations::Migrator;
    use sea_orm::{Database, EntityTrait};
    use sea_orm_migration::MigratorTrait;

    fn key(public_key: &str) -> ServerPublicKey {
        key_with_algorithm("ssh-ed25519", public_key)
    }

    fn key_with_algorithm(algorithm: &str, public_key: &str) -> ServerPublicKey {
        ServerPublicKey {
            key_algorithm: algorithm.to_string(),
            public_key: public_key.to_string(),
            fingerprint: format!("SHA256:{public_key}"),
        }
    }

    #[test]
    fn server_key_policy_is_enforced() {
        let observed = key("observed");
        assert!(verify_server_key(CheckServerKey::Disabled, "host", 22, &[], &observed).is_ok());
        assert!(verify_server_key(CheckServerKey::AcceptNew, "host", 22, &[], &observed).is_ok());
        assert!(verify_server_key(CheckServerKey::Strict, "host", 22, &[], &observed).is_err());
        assert!(
            verify_server_key(
                CheckServerKey::Strict,
                "host",
                22,
                &[observed.clone()],
                &observed,
            )
            .is_ok()
        );
        assert!(matches!(
            verify_server_key(
                CheckServerKey::AcceptNew,
                "host",
                22,
                &[key("changed")],
                &observed,
            ),
            Err(SshPoolError::HostKeyMismatch { .. })
        ));
    }

    #[tokio::test]
    async fn accept_new_allows_only_one_concurrent_first_key() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, None).await.unwrap();
        let first_known_hosts = KnownHosts::new(db.clone(), CheckServerKey::AcceptNew);
        let second_known_hosts = KnownHosts::new(db.clone(), CheckServerKey::AcceptNew);

        assert!(!Arc::ptr_eq(
            &first_known_hosts.accept_new_lock,
            &second_known_hosts.accept_new_lock,
        ));

        let first = first_known_hosts.remember_accept_new("concurrent", 22, key("first"));
        let second = second_known_hosts.remember_accept_new(
            "concurrent",
            22,
            key_with_algorithm("ecdsa-sha2-nistp256", "second"),
        );
        let (first, second) = tokio::join!(first, second);

        assert_ne!(first.is_ok(), second.is_ok());
        let stored = ssh_known_host::Entity::find().all(&db).await.unwrap();
        assert_eq!(stored.len(), 1);
    }

    #[tokio::test]
    async fn accept_new_is_idempotent_for_the_same_key() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, None).await.unwrap();
        let first_known_hosts = KnownHosts::new(db.clone(), CheckServerKey::AcceptNew);
        let second_known_hosts = KnownHosts::new(db.clone(), CheckServerKey::AcceptNew);

        let first = first_known_hosts.remember_accept_new("same", 22, key("key"));
        let second = second_known_hosts.remember_accept_new("same", 22, key("key"));
        let (first, second) = tokio::join!(first, second);

        assert!(first.is_ok());
        assert!(second.is_ok());
        let stored = ssh_known_host::Entity::find().all(&db).await.unwrap();
        assert_eq!(stored.len(), 1);
    }
}
