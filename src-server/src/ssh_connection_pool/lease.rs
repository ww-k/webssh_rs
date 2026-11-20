use std::{
    ops::{Deref, DerefMut},
    pin::Pin,
    task::{Context, Poll},
};

use russh::{Channel, ChannelMsg, ChannelReadHalf, ChannelStream, ChannelWriteHalf};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::OwnedSemaphorePermit;
use tracing::debug;

use super::connection::{ChannelPermit, ForwardingChannelPermit};

pub struct SshChannelGuard {
    channel: Option<Channel<russh::client::Msg>>,
    lease: Option<ChannelPermit>,
    forwarding_lease: Option<ForwardingChannelPermit>,
}

impl SshChannelGuard {
    pub(crate) fn new(channel: Channel<russh::client::Msg>, lease: ChannelPermit) -> Self {
        Self {
            channel: Some(channel),
            lease: Some(lease),
            forwarding_lease: None,
        }
    }

    pub(crate) fn new_forwarding(
        channel: Channel<russh::client::Msg>,
        forwarding_lease: ForwardingChannelPermit,
    ) -> Self {
        Self {
            channel: Some(channel),
            lease: None,
            forwarding_lease: Some(forwarding_lease),
        }
    }

    pub async fn wait(&mut self) -> Option<ChannelMsg> {
        let message = match self.channel.as_mut() {
            Some(channel) => channel.wait().await,
            None => None,
        };
        debug!(?message, "SSH channel message");
        message
    }

    pub fn split(
        mut self,
    ) -> Option<(
        ChannelReadHalf,
        ChannelWriteHalf<russh::client::Msg>,
        SshChannelTransferGuard,
    )> {
        let channel = self.channel.take()?;
        let lease = self.lease.take();
        let forwarding_lease = self.forwarding_lease.take();
        if lease.is_none() && forwarding_lease.is_none() {
            return None;
        }
        let (reader, writer) = channel.split();
        Some((
            reader,
            writer,
            SshChannelTransferGuard {
                lease,
                _forwarding_lease: forwarding_lease,
            },
        ))
    }

    pub fn into_split(
        self,
    ) -> Option<(
        ChannelReadHalf,
        ChannelWriteHalf<russh::client::Msg>,
        SshChannelTransferGuard,
    )> {
        self.split()
    }

    pub fn into_stream(mut self) -> Option<SshChannelStreamGuard> {
        let channel = self.channel.take()?;
        let lease = self.lease.take()?;
        let forwarding_lease = self.forwarding_lease.take();
        Some(SshChannelStreamGuard {
            stream: channel.into_stream(),
            _lease: Some(lease),
            _forwarding_lease: forwarding_lease,
            _direct_tcpip_lease: None,
        })
    }

    pub(crate) fn into_stream_with_direct_tcpip_lease(
        mut self,
        direct_tcpip_lease: OwnedSemaphorePermit,
    ) -> Option<SshChannelStreamGuard> {
        let channel = self.channel.take()?;
        let lease = self.lease.take();
        let forwarding_lease = self.forwarding_lease.take();
        if lease.is_none() && forwarding_lease.is_none() {
            return None;
        }
        Some(SshChannelStreamGuard {
            stream: channel.into_stream(),
            _lease: lease,
            _forwarding_lease: forwarding_lease,
            _direct_tcpip_lease: Some(direct_tcpip_lease),
        })
    }
}

impl Deref for SshChannelGuard {
    type Target = Channel<russh::client::Msg>;

    fn deref(&self) -> &Self::Target {
        self.channel.as_ref().expect("SSH channel guard is empty")
    }
}

impl DerefMut for SshChannelGuard {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.channel.as_mut().expect("SSH channel guard is empty")
    }
}

impl Drop for SshChannelGuard {
    fn drop(&mut self) {
        let Some(channel) = self.channel.take() else {
            return;
        };
        let lease = self.lease.take();
        let forwarding_lease = self.forwarding_lease.take();
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                let _ = channel.close().await;
                drop(lease);
                drop(forwarding_lease);
            });
        }
    }
}

pub struct SshChannelTransferGuard {
    lease: Option<ChannelPermit>,
    _forwarding_lease: Option<ForwardingChannelPermit>,
}

impl Drop for SshChannelTransferGuard {
    fn drop(&mut self) {
        drop(self.lease.take());
    }
}

pub struct SshChannelStreamGuard {
    stream: ChannelStream<russh::client::Msg>,
    _lease: Option<ChannelPermit>,
    _forwarding_lease: Option<ForwardingChannelPermit>,
    _direct_tcpip_lease: Option<OwnedSemaphorePermit>,
}

impl AsyncRead for SshChannelStreamGuard {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().stream).poll_read(cx, buf)
    }
}

impl AsyncWrite for SshChannelStreamGuard {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.get_mut().stream).poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().stream).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().stream).poll_shutdown(cx)
    }
}
