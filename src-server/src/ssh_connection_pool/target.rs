use std::{future::Future, sync::Arc};

use anyhow::{Context, Result};

use crate::{
    entities::target::{self, TargetAuthMethod},
    repositories::target as target_repository,
    sftp_client::{FastSftpClient, SftpClientGuard},
};

use super::{
    ChannelMode, SshChannelGuard, SshConnectionPool,
    connector::{SshAuth, SshConnectionSpec},
    error::{SshPoolError, SshPoolResult},
    target_connection_pool::TargetConnectionPool,
};

pub(crate) struct TargetSshContext {
    target: target::Model,
    connection_pool: SshPoolResult<Arc<TargetConnectionPool>>,
}

impl SshConnectionPool {
    async fn lifecycle_lock(&self, target_id: i32) -> Arc<tokio::sync::RwLock<()>> {
        self.lifecycle_locks
            .lock()
            .await
            .entry(target_id)
            .or_insert_with(|| Arc::new(tokio::sync::RwLock::new(())))
            .clone()
    }

    pub(crate) async fn context(&self, target_id: i32) -> Result<TargetSshContext> {
        let lifecycle_guard = self.lifecycle_lock(target_id).await.read_owned().await;
        let target = target_repository::find_by_id(&self.db, target_id)
            .await
            .with_context(|| format!("failed to query SSH target {target_id}"))?
            .ok_or_else(|| anyhow::anyhow!("SSH target {target_id} not found"))?;
        let connection_pool = match connection_spec(&target) {
            Ok(spec) => Ok(self.connection_pool_for(spec).await),
            Err(err) => Err(err),
        };
        drop(lifecycle_guard);
        Ok(TargetSshContext {
            target,
            connection_pool,
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

    pub(crate) async fn with_target_mutation<T, E, F, Fut>(
        &self,
        target_id: i32,
        mutation: F,
    ) -> std::result::Result<T, E>
    where
        F: FnOnce() -> Fut + Send,
        Fut: Future<Output = std::result::Result<T, E>> + Send,
    {
        let lifecycle_lock = self.lifecycle_lock(target_id).await;
        let _lifecycle_guard = lifecycle_lock.write_owned().await;
        self.expire_target(target_id).await;
        mutation().await
    }
}

impl TargetSshContext {
    pub(crate) fn target(&self) -> &target::Model {
        &self.target
    }

    pub(crate) async fn channel(self, mode: ChannelMode) -> Result<SshChannelGuard> {
        let connection_pool = self.connection_pool?;
        Ok(connection_pool.acquire(mode).await?)
    }
}

fn connection_spec(target: &target::Model) -> SshPoolResult<SshConnectionSpec> {
    let auth = match &target.method {
        TargetAuthMethod::Password => {
            SshAuth::Password(target.password.clone().unwrap_or_default())
        }
        TargetAuthMethod::PrivateKey => SshAuth::PrivateKey {
            key_data: target.key.clone().unwrap_or_default(),
            passphrase: target.password.clone(),
        },
        TargetAuthMethod::None => return Err(SshPoolError::UnsupportedAuthMethod),
    };
    Ok(SshConnectionSpec::new(
        target.id,
        target.user.clone(),
        target.host.clone(),
        target.port.unwrap_or(22),
        auth,
    ))
}
