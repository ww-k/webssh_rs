use std::sync::{
    Arc,
    atomic::{AtomicU8, Ordering},
};

use russh::{Channel, Disconnect};
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};
use tracing::debug;

use super::{
    connector::{ConnectedSsh, SshClientHandler},
    error::{SshPoolError, SshPoolResult},
    target_connection_pool::TargetConnectionPool,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum ConnectionState {
    Active = 0,
    Expiring = 1,
    Closed = 2,
}

impl ConnectionState {
    fn from_u8(value: u8) -> Self {
        match value {
            0 => Self::Active,
            1 => Self::Expiring,
            _ => Self::Closed,
        }
    }
}

pub(crate) struct SshConnection {
    id: String,
    handle: russh::client::Handle<SshClientHandler>,
    permits: Arc<Semaphore>,
    max_channels: usize,
    state: AtomicU8,
    notify: Arc<Notify>,
    owner: std::sync::Weak<TargetConnectionPool>,
}

impl SshConnection {
    pub(crate) fn new(
        connected: ConnectedSsh,
        max_channels: usize,
        notify: Arc<Notify>,
        owner: std::sync::Weak<TargetConnectionPool>,
    ) -> Arc<Self> {
        let connection = Arc::new(Self {
            id: nanoid::nanoid!(),
            handle: connected.handle,
            permits: Arc::new(Semaphore::new(max_channels)),
            max_channels,
            state: AtomicU8::new(ConnectionState::Active as u8),
            notify,
            owner,
        });
        Self::start_disconnect_watcher(&connection, connected.disconnected);
        connection
    }

    fn start_disconnect_watcher(
        connection: &Arc<Self>,
        disconnected: tokio::sync::oneshot::Receiver<()>,
    ) {
        let weak = Arc::downgrade(connection);
        tokio::spawn(async move {
            let _ = disconnected.await;
            if let Some(connection) = weak.upgrade() {
                connection.mark_closed();
                connection.remove_from_owner().await;
            }
        });
    }

    pub(crate) fn id(&self) -> &str {
        &self.id
    }

    pub(crate) fn state(&self) -> ConnectionState {
        ConnectionState::from_u8(self.state.load(Ordering::Acquire))
    }

    pub(crate) fn active_channels(&self) -> usize {
        self.max_channels
            .saturating_sub(self.permits.available_permits())
    }

    pub(crate) fn is_idle(&self) -> bool {
        self.permits.available_permits() == self.max_channels
    }

    pub(crate) fn try_reserve(self: &Arc<Self>) -> Option<ChannelPermit> {
        if self.state() != ConnectionState::Active {
            return None;
        }
        let permit = Arc::clone(&self.permits).try_acquire_owned().ok()?;
        if self.state() != ConnectionState::Active {
            drop(permit);
            return None;
        }
        Some(ChannelPermit {
            permit: Some(permit),
            connection: Arc::clone(self),
        })
    }

    pub(crate) async fn open_channel(&self) -> SshPoolResult<Channel<russh::client::Msg>> {
        if self.state() == ConnectionState::Closed || self.handle.is_closed() {
            return Err(SshPoolError::ConnectionExpired {
                connection_id: self.id.clone(),
            });
        }
        Ok(self.handle.channel_open_session().await?)
    }

    pub(crate) fn expire(self: &Arc<Self>) {
        let _ = self.state.compare_exchange(
            ConnectionState::Active as u8,
            ConnectionState::Expiring as u8,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
        self.notify.notify_waiters();
        self.close_if_expired_and_idle();
    }

    fn close_if_expired_and_idle(self: &Arc<Self>) {
        if self.state() != ConnectionState::Expiring || !self.is_idle() {
            return;
        }
        let connection = Arc::clone(self);
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                connection.close().await;
            });
        }
    }

    async fn close(self: Arc<Self>) {
        if self
            .state
            .swap(ConnectionState::Closed as u8, Ordering::AcqRel)
            == ConnectionState::Closed as u8
        {
            return;
        }
        debug!(connection_id = self.id, "closing SSH connection");
        let _ = self
            .handle
            .disconnect(Disconnect::ByApplication, "", "English")
            .await;
        self.notify.notify_waiters();
        self.remove_from_owner().await;
    }

    fn mark_closed(&self) {
        if self
            .state
            .swap(ConnectionState::Closed as u8, Ordering::AcqRel)
            != ConnectionState::Closed as u8
        {
            debug!(connection_id = self.id, "SSH connection marked closed");
        }
        self.notify.notify_waiters();
    }

    fn on_permit_released(self: &Arc<Self>) {
        self.notify.notify_one();
        self.close_if_expired_and_idle();
    }

    async fn remove_from_owner(&self) {
        if let Some(owner) = self.owner.upgrade() {
            owner.remove_closed(&self.id).await;
        }
    }
}

pub(crate) struct ChannelPermit {
    permit: Option<OwnedSemaphorePermit>,
    connection: Arc<SshConnection>,
}

impl Drop for ChannelPermit {
    fn drop(&mut self) {
        drop(self.permit.take());
        self.connection.on_permit_released();
    }
}
