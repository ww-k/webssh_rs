use std::{
    fmt, io,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    task::{Context, Poll},
    time::Duration,
};

use russh::{
    Preferred, cipher,
    client::DisconnectReason,
    compression,
    keys::{HashAlg, PrivateKeyWithHashAlg, PublicKeyBase64, decode_secret_key, ssh_key},
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::TcpStream,
    sync::oneshot,
    time::{Instant, Sleep},
};
use tracing::{debug, warn};

use super::{
    error::{SshPoolError, SshPoolResult},
    known_hosts::{KnownHosts, ServerPublicKey, verify_server_key},
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone)]
struct ConnectDeadline {
    inner: Arc<ConnectDeadlineInner>,
}

struct ConnectDeadlineInner {
    at: Instant,
    timeout: Duration,
    enabled: AtomicBool,
    timed_out: AtomicBool,
}

impl ConnectDeadline {
    fn new(timeout: Duration) -> Self {
        Self {
            inner: Arc::new(ConnectDeadlineInner {
                at: Instant::now() + timeout,
                timeout,
                enabled: AtomicBool::new(true),
                timed_out: AtomicBool::new(false),
            }),
        }
    }

    fn at(&self) -> Instant {
        self.inner.at
    }

    fn is_enabled(&self) -> bool {
        self.inner.enabled.load(Ordering::Acquire)
    }

    fn disable(&self) {
        self.inner.enabled.store(false, Ordering::Release);
    }

    fn mark_timed_out(&self) {
        self.inner.timed_out.store(true, Ordering::Release);
    }

    fn timed_out(&self) -> bool {
        self.inner.timed_out.load(Ordering::Acquire)
    }

    fn pool_error(&self) -> SshPoolError {
        SshPoolError::ConnectTimeout {
            timeout: self.inner.timeout,
        }
    }

    fn map_result<T>(&self, result: SshPoolResult<T>) -> SshPoolResult<T> {
        if self.timed_out() {
            Err(self.pool_error())
        } else {
            result
        }
    }

    fn io_error(&self) -> io::Error {
        self.mark_timed_out();
        io::Error::new(
            io::ErrorKind::TimedOut,
            format!("SSH connection timed out after {:?}", self.inner.timeout),
        )
    }

    async fn run<T>(&self, future: impl Future<Output = SshPoolResult<T>>) -> SshPoolResult<T> {
        match tokio::time::timeout_at(self.at(), future).await {
            Ok(result) => result,
            Err(_) => {
                self.mark_timed_out();
                Err(self.pool_error())
            }
        }
    }
}

struct DeadlineStream<R> {
    inner: R,
    deadline: Pin<Box<Sleep>>,
    control: ConnectDeadline,
}

impl<R> DeadlineStream<R> {
    fn new(inner: R, control: ConnectDeadline) -> Self {
        Self {
            inner,
            deadline: Box::pin(tokio::time::sleep_until(control.at())),
            control,
        }
    }

    fn poll_timeout(&mut self, cx: &mut Context<'_>) -> Option<io::Error> {
        if self.control.is_enabled() && self.deadline.as_mut().poll(cx).is_ready() {
            Some(self.control.io_error())
        } else {
            None
        }
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for DeadlineStream<R> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if let Some(err) = self.poll_timeout(cx) {
            return Poll::Ready(Err(err));
        }
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl<R: AsyncWrite + Unpin> AsyncWrite for DeadlineStream<R> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        if let Some(err) = self.poll_timeout(cx) {
            return Poll::Ready(Err(err));
        }
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if let Some(err) = self.poll_timeout(cx) {
            return Poll::Ready(Err(err));
        }
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if let Some(err) = self.poll_timeout(cx) {
            return Poll::Ready(Err(err));
        }
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }

    fn is_write_vectored(&self) -> bool {
        self.inner.is_write_vectored()
    }

    fn poll_write_vectored(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[io::IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        if let Some(err) = self.poll_timeout(cx) {
            return Poll::Ready(Err(err));
        }
        Pin::new(&mut self.inner).poll_write_vectored(cx, bufs)
    }
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) enum SshAuth {
    Password(String),
    PrivateKey {
        key_data: String,
        passphrase: Option<String>,
    },
}

impl SshAuth {
    fn kind(&self) -> &'static str {
        match self {
            Self::Password(_) => "password",
            Self::PrivateKey { .. } => "private_key",
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct SshConnectionSpec {
    target_id: i32,
    username: String,
    host: String,
    port: u16,
    auth: SshAuth,
}

impl SshConnectionSpec {
    pub(crate) fn new(
        target_id: i32,
        username: String,
        host: String,
        port: u16,
        auth: SshAuth,
    ) -> Self {
        Self {
            target_id,
            username,
            host,
            port,
            auth,
        }
    }

    pub(crate) fn target_id(&self) -> i32 {
        self.target_id
    }
}

impl fmt::Debug for SshConnectionSpec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SshConnectionSpec")
            .field("target_id", &self.target_id)
            .field("username", &self.username)
            .field("host", &self.host)
            .field("port", &self.port)
            .field("auth", &self.auth.kind())
            .finish()
    }
}

pub(crate) struct ConnectedSsh {
    pub(crate) handle: russh::client::Handle<SshClientHandler>,
    pub(crate) disconnected: oneshot::Receiver<()>,
}

#[derive(Clone)]
pub struct SshConnector {
    known_hosts: KnownHosts,
    connect_timeout: Duration,
}

impl SshConnector {
    pub(crate) fn new(known_hosts: KnownHosts) -> Self {
        Self {
            known_hosts,
            connect_timeout: CONNECT_TIMEOUT,
        }
    }

    pub(crate) async fn connect(&self, spec: &SshConnectionSpec) -> SshPoolResult<ConnectedSsh> {
        let timeout = self.connect_timeout;
        let deadline = ConnectDeadline::new(timeout);
        self.connect_inner(spec, deadline).await
    }

    async fn connect_inner(
        &self,
        spec: &SshConnectionSpec,
        deadline: ConnectDeadline,
    ) -> SshPoolResult<ConnectedSsh> {
        let config = russh::client::Config {
            window_size: 16 * 1024 * 1024,
            maximum_packet_size: 64 * 1024,
            nodelay: true,
            preferred: Preferred {
                cipher: std::borrow::Cow::Borrowed(&[
                    cipher::AES_128_GCM,
                    cipher::AES_256_GCM,
                    cipher::AES_128_CTR,
                    cipher::AES_256_CTR,
                    cipher::CHACHA20_POLY1305,
                ]),
                compression: std::borrow::Cow::Borrowed(&[compression::NONE]),
                ..Default::default()
            },
            ..Default::default()
        };

        let pinned_server_public_keys = deadline
            .run(self.known_hosts.load(&spec.host, spec.port))
            .await?;
        let (disconnect_tx, disconnect_rx) = oneshot::channel();
        let handler = SshClientHandler {
            host: spec.host.clone(),
            port: spec.port,
            known_hosts: self.known_hosts.clone(),
            pinned_server_public_keys,
            disconnect_tx: Some(disconnect_tx),
            connect_deadline: deadline.clone(),
        };

        let socket = match tokio::time::timeout_at(
            deadline.at(),
            TcpStream::connect((spec.host.as_str(), spec.port)),
        )
        .await
        {
            Ok(Ok(socket)) => socket,
            Ok(Err(err)) => return Err(russh::Error::from(err).into()),
            Err(_) => {
                deadline.mark_timed_out();
                return Err(deadline.pool_error());
            }
        };
        if config.nodelay
            && let Err(err) = socket.set_nodelay(true)
        {
            warn!(?err, "failed to enable TCP_NODELAY for SSH connection");
        }
        let stream = DeadlineStream::new(socket, deadline.clone());
        let handle_result = russh::client::connect_stream(Arc::new(config), stream, handler).await;
        let mut handle = deadline.map_result(handle_result)?;

        let auth_result = match &spec.auth {
            SshAuth::Password(password) => {
                handle
                    .authenticate_password(spec.username.as_str(), password.as_str())
                    .await
            }
            SshAuth::PrivateKey {
                key_data,
                passphrase,
            } => {
                let private_key = decode_secret_key(key_data, passphrase.as_deref())?;
                let private_key =
                    PrivateKeyWithHashAlg::new(Arc::new(private_key), Some(HashAlg::Sha256));
                handle
                    .authenticate_publickey(spec.username.as_str(), private_key)
                    .await
            }
        };
        let auth_result = deadline.map_result(auth_result.map_err(SshPoolError::from))?;

        if !auth_result.success() {
            return Err(SshPoolError::AuthenticationFailed);
        }
        deadline.disable();

        debug!(
            target_id = spec.target_id,
            host = spec.host,
            port = spec.port,
            "SSH connection established"
        );

        Ok(ConnectedSsh {
            handle,
            disconnected: disconnect_rx,
        })
    }
}

pub(crate) struct SshClientHandler {
    host: String,
    port: u16,
    known_hosts: KnownHosts,
    pinned_server_public_keys: Vec<ServerPublicKey>,
    disconnect_tx: Option<oneshot::Sender<()>>,
    connect_deadline: ConnectDeadline,
}

impl russh::client::Handler for SshClientHandler {
    type Error = SshPoolError;

    fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> impl Future<Output = SshPoolResult<bool>> + Send {
        let observed = ServerPublicKey {
            key_algorithm: server_public_key.algorithm().as_str().to_string(),
            public_key: server_public_key.public_key_base64(),
            fingerprint: server_public_key.fingerprint(HashAlg::Sha256).to_string(),
        };
        let host = self.host.clone();
        let port = self.port;
        let known_hosts = self.known_hosts.clone();
        let pinned = self.pinned_server_public_keys.clone();
        let deadline = self.connect_deadline.clone();

        async move {
            debug!(
                host,
                port,
                algorithm = observed.key_algorithm,
                fingerprint = observed.fingerprint,
                "checking SSH server key"
            );
            deadline
                .run(async move {
                    verify_server_key(known_hosts.policy(), &host, port, &pinned, &observed)?;
                    known_hosts
                        .remember_accept_new(&host, port, observed)
                        .await?;
                    Ok(true)
                })
                .await
        }
    }

    fn disconnected(
        &mut self,
        reason: DisconnectReason<Self::Error>,
    ) -> impl Future<Output = SshPoolResult<()>> + Send {
        let disconnect_tx = self.disconnect_tx.take();
        async move {
            debug!(?reason, "SSH connection disconnected");
            if let Some(tx) = disconnect_tx {
                let _ = tx.send(());
            }
            match reason {
                DisconnectReason::ReceivedDisconnect(_) => Ok(()),
                DisconnectReason::Error(err) => Err(err),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    struct AcceptAnyServerKey;

    struct TestServer;

    impl russh::client::Handler for AcceptAnyServerKey {
        type Error = russh::Error;

        fn check_server_key(
            &mut self,
            _server_public_key: &ssh_key::PublicKey,
        ) -> impl Future<Output = Result<bool, Self::Error>> + Send {
            async { Ok(true) }
        }
    }

    impl russh::server::Handler for TestServer {
        type Error = russh::Error;
    }

    #[test]
    fn connection_spec_debug_redacts_auth_secrets() {
        let specs = [
            SshConnectionSpec::new(
                1,
                "user".to_string(),
                "host".to_string(),
                22,
                SshAuth::Password("password-secret".to_string()),
            ),
            SshConnectionSpec::new(
                1,
                "user".to_string(),
                "host".to_string(),
                22,
                SshAuth::PrivateKey {
                    key_data: "private-key-secret".to_string(),
                    passphrase: Some("passphrase-secret".to_string()),
                },
            ),
        ];

        for spec in specs {
            let debug = format!("{spec:?}");
            assert!(!debug.contains("password-secret"));
            assert!(!debug.contains("private-key-secret"));
            assert!(!debug.contains("passphrase-secret"));
        }
    }

    #[tokio::test]
    async fn deadline_ends_a_session_stalled_during_key_exchange() {
        let (client, mut server) = tokio::io::duplex(4096);
        let deadline = ConnectDeadline::new(Duration::from_millis(20));
        let stream = DeadlineStream::new(client, deadline.clone());
        let server_task = tokio::spawn(async move {
            server.write_all(b"SSH-2.0-stalled-test\r\n").await.unwrap();
            let mut received = Vec::new();
            server.read_to_end(&mut received).await.unwrap();
            received
        });

        let result = tokio::time::timeout(
            Duration::from_secs(1),
            russh::client::connect_stream(
                Arc::new(russh::client::Config::default()),
                stream,
                AcceptAnyServerKey,
            ),
        )
        .await
        .expect("stalled key exchange should finish at the connection deadline");

        let result = deadline.map_result(result.map_err(SshPoolError::from));
        assert!(matches!(
            result,
            Err(SshPoolError::ConnectTimeout { timeout })
                if timeout == Duration::from_millis(20)
        ));
        let received = tokio::time::timeout(Duration::from_secs(1), server_task)
            .await
            .expect("the timed-out russh session should close its stream")
            .unwrap();
        assert!(received.starts_with(b"SSH-2.0-"));
    }

    #[tokio::test]
    async fn dropping_a_handle_before_authentication_stops_the_session_promptly() {
        let (client, server) = tokio::io::duplex(64 * 1024);
        let server_config = Arc::new(russh::server::Config {
            keys: vec![
                russh::keys::PrivateKey::random(&mut rand::rng(), ssh_key::Algorithm::Ed25519)
                    .unwrap(),
            ],
            ..Default::default()
        });
        let server_task = tokio::spawn(async move {
            let session = russh::server::run_stream(server_config, server, TestServer)
                .await
                .unwrap();
            session.await
        });
        let deadline = ConnectDeadline::new(Duration::from_secs(5));
        let stream = DeadlineStream::new(client, deadline.clone());
        let handle = tokio::time::timeout(
            Duration::from_secs(1),
            russh::client::connect_stream(
                Arc::new(russh::client::Config::default()),
                stream,
                AcceptAnyServerKey,
            ),
        )
        .await
        .expect("key exchange should complete")
        .unwrap();

        drop(handle);
        let _server_result = tokio::time::timeout(Duration::from_secs(1), server_task)
            .await
            .expect("dropping the only handle should stop the SSH session before its deadline")
            .unwrap();
        assert!(!deadline.timed_out());
    }

    #[tokio::test]
    async fn disabled_deadline_does_not_expire_an_established_stream() {
        let (client, mut server) = tokio::io::duplex(64);
        let deadline = ConnectDeadline::new(Duration::from_millis(10));
        let mut stream = DeadlineStream::new(client, deadline.clone());
        deadline.disable();

        tokio::time::sleep(Duration::from_millis(20)).await;
        server.write_all(b"ok").await.unwrap();
        let mut received = [0; 2];
        stream.read_exact(&mut received).await.unwrap();

        assert_eq!(&received, b"ok");
        assert!(!deadline.timed_out());
    }
}
