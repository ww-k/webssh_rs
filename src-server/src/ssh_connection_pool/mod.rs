mod connection;
mod connector;
mod error;
mod known_hosts;
mod lease;
mod target_connection_pool;
#[cfg(test)]
mod tests;

use std::{collections::HashMap, sync::Arc};

use sea_orm::DatabaseConnection;
use tokio::sync::Mutex;

use crate::config::CheckServerKey;

pub use connection::ConnectionState;
pub(crate) use connector::{SshAuth, SshConnectionSpec};
pub use error::{SshPoolError, SshPoolResult};
pub use lease::{SshChannelGuard, SshChannelStreamGuard, SshChannelTransferGuard};
pub(crate) use target_connection_pool::TargetConnectionPool;

use connector::SshConnector;
use known_hosts::KnownHosts;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ChannelMode {
    #[default]
    Shared,
    Dedicated,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConnectionSnapshot {
    pub id: String,
    pub state: ConnectionState,
    pub target_id: i32,
    pub active_channels: usize,
}

pub(crate) struct SshConnectionPool {
    target_connection_pools: Mutex<HashMap<i32, Arc<TargetConnectionPool>>>,
    expired_connection_pools: Arc<Mutex<Vec<Arc<TargetConnectionPool>>>>,
    connector: Arc<SshConnector>,
    max_connections_per_target: usize,
    max_channels_per_connection: usize,
}

impl SshConnectionPool {
    pub(crate) fn new(
        db: DatabaseConnection,
        check_server_key: CheckServerKey,
        max_connections_per_target: usize,
        max_channels_per_connection: usize,
    ) -> Self {
        let known_hosts = KnownHosts::new(db, check_server_key);
        Self {
            target_connection_pools: Mutex::new(HashMap::new()),
            expired_connection_pools: Arc::new(Mutex::new(Vec::new())),
            connector: Arc::new(SshConnector::new(known_hosts)),
            max_connections_per_target,
            max_channels_per_connection,
        }
    }

    pub(crate) async fn connection_pool_for(
        &self,
        spec: SshConnectionSpec,
    ) -> Arc<TargetConnectionPool> {
        let target_id = spec.target_id();
        let (target_connection_pool, expired_connection_pool) = {
            let mut target_connection_pools = self.target_connection_pools.lock().await;
            if let Some(existing) = target_connection_pools.get(&target_id) {
                if existing.matches(&spec) {
                    (Arc::clone(existing), None)
                } else {
                    let expired = target_connection_pools.remove(&target_id);
                    let pool = Arc::new(TargetConnectionPool::new(
                        spec,
                        Arc::clone(&self.connector),
                        self.max_connections_per_target,
                        self.max_channels_per_connection,
                    ));
                    target_connection_pools.insert(target_id, Arc::clone(&pool));
                    (pool, expired)
                }
            } else {
                let pool = Arc::new(TargetConnectionPool::new(
                    spec,
                    Arc::clone(&self.connector),
                    self.max_connections_per_target,
                    self.max_channels_per_connection,
                ));
                target_connection_pools.insert(target_id, Arc::clone(&pool));
                (pool, None)
            }
        };

        if let Some(expired_connection_pool) = expired_connection_pool {
            self.schedule_expire(expired_connection_pool).await;
        }
        target_connection_pool
    }

    pub(crate) async fn expire_target(&self, target_id: i32) {
        let target_connection_pool = self.target_connection_pools.lock().await.remove(&target_id);
        if let Some(target_connection_pool) = target_connection_pool {
            self.schedule_expire(target_connection_pool).await;
        }
    }

    pub(crate) async fn expire_connection(&self, target_id: i32, connection_id: &str) -> bool {
        let mut target_connection_pools = Vec::new();
        if let Some(target_connection_pool) = self
            .target_connection_pools
            .lock()
            .await
            .get(&target_id)
            .cloned()
        {
            target_connection_pools.push(target_connection_pool);
        }
        target_connection_pools.extend(
            self.expired_connection_pools
                .lock()
                .await
                .iter()
                .filter(|pool| pool.target_id() == target_id)
                .cloned(),
        );
        for target_connection_pool in target_connection_pools {
            if target_connection_pool
                .expire_connection(connection_id)
                .await
            {
                return true;
            }
        }
        false
    }

    pub(crate) async fn connection_snapshots(
        &self,
        target_filter: Option<i32>,
    ) -> Vec<ConnectionSnapshot> {
        let mut target_connection_pools: Vec<_> = self
            .target_connection_pools
            .lock()
            .await
            .iter()
            .filter(|(target_id, _)| target_filter.is_none_or(|filter| filter == **target_id))
            .map(|(_, pool)| Arc::clone(pool))
            .collect();
        target_connection_pools.extend(
            self.expired_connection_pools
                .lock()
                .await
                .iter()
                .filter(|pool| target_filter.is_none_or(|filter| filter == pool.target_id()))
                .cloned(),
        );

        let mut snapshots = Vec::new();
        for target_connection_pool in target_connection_pools {
            snapshots.extend(target_connection_pool.snapshots().await);
        }
        snapshots
    }

    async fn schedule_expire(&self, target_connection_pool: Arc<TargetConnectionPool>) {
        let expired_connection_pools = Arc::clone(&self.expired_connection_pools);
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            expired_connection_pools
                .lock()
                .await
                .push(Arc::clone(&target_connection_pool));
            target_connection_pool.expire().await;
            let _ = ready_tx.send(());
            target_connection_pool.wait_until_empty().await;
            expired_connection_pools
                .lock()
                .await
                .retain(|pool| !Arc::ptr_eq(pool, &target_connection_pool));
        });
        let _ = ready_rx.await;
    }
}
