use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use tokio::sync::{Mutex, Notify};
use tracing::debug;

use super::{
    ChannelMode, ConnectionSnapshot,
    connection::{ChannelPermit, ConnectionState, SshConnection},
    connector::{SshConnectionSpec, SshConnector},
    error::{SshPoolError, SshPoolResult},
    lease::SshChannelGuard,
};

pub(crate) struct TargetConnectionPool {
    spec: SshConnectionSpec,
    connector: Arc<SshConnector>,
    connections: Mutex<Vec<Arc<SshConnection>>>,
    connect_lock: Mutex<()>,
    notify: Arc<Notify>,
    max_connections: usize,
    max_channels_per_connection: usize,
    expired: AtomicBool,
}

impl TargetConnectionPool {
    pub(crate) fn new(
        spec: SshConnectionSpec,
        connector: Arc<SshConnector>,
        max_connections: usize,
        max_channels_per_connection: usize,
    ) -> Self {
        Self {
            spec,
            connector,
            connections: Mutex::new(Vec::new()),
            connect_lock: Mutex::new(()),
            notify: Arc::new(Notify::new()),
            max_connections,
            max_channels_per_connection,
            expired: AtomicBool::new(false),
        }
    }

    pub(crate) fn matches(&self, spec: &SshConnectionSpec) -> bool {
        self.spec == *spec && !self.expired.load(Ordering::Acquire)
    }

    pub(crate) fn target_id(&self) -> i32 {
        self.spec.target_id()
    }

    pub(crate) async fn acquire(
        self: &Arc<Self>,
        mode: ChannelMode,
    ) -> SshPoolResult<SshChannelGuard> {
        if self.max_connections == 0 {
            return Err(SshPoolError::CapacityExceeded {
                resource: "SSH connection",
                limit: 0,
            });
        }
        if self.max_channels_per_connection == 0 {
            return Err(SshPoolError::CapacityExceeded {
                resource: "SSH channel",
                limit: 0,
            });
        }

        loop {
            self.ensure_active()?;
            if let Some(reservation) = self.try_existing(mode).await {
                return self.open_reserved(reservation).await;
            }

            let connect_guard = self.connect_lock.lock().await;
            self.ensure_active()?;
            let notified = self.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();

            if let Some(reservation) = self.try_existing(mode).await {
                return self.open_reserved(reservation).await;
            }

            let connection_count = {
                let mut connections = self.connections.lock().await;
                connections.retain(|connection| connection.state() != ConnectionState::Closed);
                connections.len()
            };

            if connection_count >= self.max_connections {
                drop(connect_guard);
                notified.await;
                continue;
            }

            let connected = self.connector.connect(&self.spec).await?;
            let connection = SshConnection::new(
                connected,
                self.max_channels_per_connection,
                Arc::clone(&self.notify),
                Arc::downgrade(self),
            );

            if let Err(err) = self.ensure_active() {
                connection.expire();
                return Err(err);
            }

            let reservation =
                connection
                    .try_reserve()
                    .ok_or_else(|| SshPoolError::ConnectionExpired {
                        connection_id: connection.id().to_string(),
                    })?;
            if mode == ChannelMode::Dedicated {
                connection.expire();
            }
            self.connections.lock().await.push(Arc::clone(&connection));
            debug!(
                target_id = self.spec.target_id(),
                connection_id = connection.id(),
                ?mode,
                "registered SSH connection"
            );
            return self.open_reserved((connection, reservation)).await;
        }
    }

    async fn try_existing(&self, mode: ChannelMode) -> Option<(Arc<SshConnection>, ChannelPermit)> {
        let mut connections = self.connections.lock().await;
        connections.retain(|connection| connection.state() != ConnectionState::Closed);

        match mode {
            ChannelMode::Shared => connections.iter().find_map(|connection| {
                connection
                    .try_reserve()
                    .map(|permit| (Arc::clone(connection), permit))
            }),
            ChannelMode::Dedicated => connections.iter().find_map(|connection| {
                if !connection.is_idle() {
                    return None;
                }
                let permit = connection.try_reserve()?;
                connection.expire();
                Some((Arc::clone(connection), permit))
            }),
        }
    }

    async fn open_reserved(
        self: &Arc<Self>,
        (connection, permit): (Arc<SshConnection>, ChannelPermit),
    ) -> SshPoolResult<SshChannelGuard> {
        let connection_id = connection.id().to_string();
        let pool = Arc::clone(self);
        let (result_tx, result_rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let result = match connection.open_channel().await {
                Ok(channel) => {
                    debug!(
                        connection_id = connection.id(),
                        channel_id = ?channel.id(),
                        "opened SSH channel"
                    );
                    let guard = SshChannelGuard::new(channel, permit);
                    match pool.ensure_active() {
                        Ok(()) => Ok(guard),
                        Err(err) => {
                            drop(guard);
                            Err(err)
                        }
                    }
                }
                Err(err) => {
                    connection.expire();
                    Err(err)
                }
            };
            if let Err(result) = result_tx.send(result) {
                drop(result);
            }
        });

        result_rx
            .await
            .map_err(|_| SshPoolError::ConnectionExpired { connection_id })?
    }

    fn ensure_active(&self) -> SshPoolResult<()> {
        if self.expired.load(Ordering::Acquire) {
            return Err(SshPoolError::ConnectionExpired {
                connection_id: format!("target:{}", self.spec.target_id()),
            });
        }
        Ok(())
    }

    pub(crate) async fn expire(&self) {
        if self.expired.swap(true, Ordering::AcqRel) {
            return;
        }
        let connections = self.connections.lock().await.clone();
        for connection in connections {
            connection.expire();
        }
        self.notify.notify_waiters();
    }

    pub(crate) async fn expire_connection(&self, connection_id: &str) -> bool {
        let connection = self
            .connections
            .lock()
            .await
            .iter()
            .find(|connection| connection.id() == connection_id)
            .cloned();
        if let Some(connection) = connection {
            connection.expire();
            true
        } else {
            false
        }
    }

    pub(crate) async fn snapshots(&self) -> Vec<ConnectionSnapshot> {
        let connections = self.connections.lock().await;
        connections
            .iter()
            .map(|connection| ConnectionSnapshot {
                id: connection.id().to_string(),
                state: connection.state(),
                target_id: self.spec.target_id(),
                active_channels: connection.active_channels(),
            })
            .collect()
    }

    pub(crate) async fn remove_closed(&self, connection_id: &str) {
        self.connections
            .lock()
            .await
            .retain(|connection| connection.id() != connection_id);
        self.notify.notify_waiters();
    }

    pub(crate) async fn wait_until_empty(&self) {
        loop {
            let notified = self.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.connections.lock().await.is_empty() {
                return;
            }
            notified.await;
        }
    }
}
