use std::{collections::HashMap, sync::Arc};

use anyhow::{Context, Result};
use sea_orm::DatabaseConnection;
use tokio::sync::{Mutex, OwnedRwLockReadGuard, RwLock};

use crate::{
    entities::target::{self, TargetAuthMethod},
    repositories::target as target_repository,
    sftp_client::{FastSftpClient, SftpClientGuard},
    ssh_connection_pool::{
        ChannelMode, SshAuth, SshChannelGuard, SshConnectionPool, SshConnectionSpec, SshPoolError,
    },
};

#[derive(Clone)]
pub(crate) struct TargetSshService {
    db: DatabaseConnection,
    pool: Arc<SshConnectionPool>,
    lifecycle_locks: Arc<Mutex<HashMap<i32, Arc<RwLock<()>>>>>,
}

pub(crate) struct TargetSshContext {
    target: target::Model,
    pool: Arc<SshConnectionPool>,
    _lifecycle_guard: OwnedRwLockReadGuard<()>,
}

impl TargetSshService {
    pub(crate) fn new(db: DatabaseConnection, pool: Arc<SshConnectionPool>) -> Self {
        Self {
            db,
            pool,
            lifecycle_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn lifecycle_lock(&self, target_id: i32) -> Arc<RwLock<()>> {
        self.lifecycle_locks
            .lock()
            .await
            .entry(target_id)
            .or_insert_with(|| Arc::new(RwLock::new(())))
            .clone()
    }

    pub(crate) async fn context(&self, target_id: i32) -> Result<TargetSshContext> {
        let lifecycle_guard = self.lifecycle_lock(target_id).await.read_owned().await;
        let target = target_repository::find_by_id(&self.db, target_id)
            .await
            .with_context(|| format!("failed to query SSH target {target_id}"))?
            .ok_or_else(|| anyhow::anyhow!("SSH target {target_id} not found"))?;
        Ok(TargetSshContext {
            target,
            pool: Arc::clone(&self.pool),
            _lifecycle_guard: lifecycle_guard,
        })
    }

    pub(crate) async fn channel(
        &self,
        target_id: i32,
        mode: ChannelMode,
    ) -> Result<SshChannelGuard> {
        self.context(target_id).await?.channel(mode).await
    }

    pub(crate) async fn sftp(&self, target_id: i32, mode: ChannelMode) -> Result<SftpClientGuard> {
        let channel = self.channel(target_id, mode).await?;
        let client = FastSftpClient::new(channel).await?;
        Ok(SftpClientGuard::new(client))
    }

    pub(crate) async fn update_target(
        &self,
        active_model: target::ActiveModel,
    ) -> Result<target::Model> {
        let target_id = active_model
            .id
            .try_as_ref()
            .copied()
            .context("SSH target update is missing its ID")?;
        let lifecycle_lock = self.lifecycle_lock(target_id).await;
        let _lifecycle_guard = lifecycle_lock.write_owned().await;
        self.pool.expire_target(target_id).await;
        target_repository::update(&self.db, active_model)
            .await
            .with_context(|| format!("failed to update SSH target {target_id}"))
    }

    pub(crate) async fn remove_target(&self, target_id: i32) -> Result<()> {
        let lifecycle_lock = self.lifecycle_lock(target_id).await;
        let _lifecycle_guard = lifecycle_lock.write_owned().await;
        self.pool.expire_target(target_id).await;
        target_repository::delete_by_id(&self.db, target_id)
            .await
            .with_context(|| format!("failed to remove SSH target {target_id}"))?;
        Ok(())
    }
}

impl TargetSshContext {
    pub(crate) fn target(&self) -> &target::Model {
        &self.target
    }

    pub(crate) async fn channel(self, mode: ChannelMode) -> Result<SshChannelGuard> {
        let auth = match self.target.method {
            TargetAuthMethod::Password => {
                SshAuth::Password(self.target.password.clone().unwrap_or_default())
            }
            TargetAuthMethod::PrivateKey => SshAuth::PrivateKey {
                key_data: self.target.key.clone().unwrap_or_default(),
                passphrase: self.target.password.clone(),
            },
            TargetAuthMethod::None => return Err(SshPoolError::UnsupportedAuthMethod.into()),
        };
        let spec = SshConnectionSpec::new(
            self.target.id,
            self.target.user.clone(),
            self.target.host.clone(),
            self.target.port.unwrap_or(22),
            auth,
        );
        let connection_pool = self.pool.connection_pool_for(spec).await;
        drop(self);
        Ok(connection_pool.acquire(mode).await?)
    }
}
