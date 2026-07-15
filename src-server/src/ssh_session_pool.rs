use std::{
    collections::{HashMap, VecDeque},
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    task::{Context, Poll},
    time::Duration,
};

use anyhow::{Ok, Result};
use russh::{
    Channel, ChannelMsg, ChannelReadHalf, ChannelStream, ChannelWriteHalf, Disconnect, Preferred,
    cipher,
    client::DisconnectReason,
    compression,
    keys::{HashAlg, PrivateKeyWithHashAlg, PublicKeyBase64, decode_secret_key, ssh_key},
};
use sea_orm::{ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter};
use serde::Serialize;
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    sync::{Mutex, MutexGuard, oneshot},
};
use tracing::debug;
use utoipa::ToSchema;

use crate::{
    AppBaseState,
    apis::target::get_target_by_id,
    config::CheckServerKey,
    entities::{
        ssh_known_host,
        target::{self, TargetAuthMethod},
    },
    sftp_client::FastSftpClient,
};

#[derive(Clone)]
struct ServerPublicKey {
    key_algorithm: String,
    public_key: String,
    fingerprint: String,
}

struct SshClientHandler {
    host: String,
    check_server_key: CheckServerKey,
    pinned_server_public_keys: Vec<ServerPublicKey>,
    observed_server_public_key: Arc<Mutex<Option<ServerPublicKey>>>,
    tx: Option<oneshot::Sender<bool>>,
}

impl SshClientHandler {
    fn verify_server_key(
        check_server_key: CheckServerKey,
        pinned_server_public_keys: &[ServerPublicKey],
        observed_key: &ServerPublicKey,
    ) -> bool {
        match check_server_key {
            CheckServerKey::Disabled => true,
            CheckServerKey::AcceptNew => {
                pinned_server_public_keys.is_empty()
                    || pinned_server_public_keys
                        .iter()
                        .any(|pinned_key| pinned_key.matches(observed_key))
            }
            CheckServerKey::Strict => pinned_server_public_keys
                .iter()
                .any(|pinned_key| pinned_key.matches(observed_key)),
        }
    }
}

impl ServerPublicKey {
    fn matches(&self, observed_key: &ServerPublicKey) -> bool {
        self.key_algorithm == observed_key.key_algorithm
            && self.public_key == observed_key.public_key
    }
}

impl russh::client::Handler for SshClientHandler {
    type Error = anyhow::Error;

    fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send {
        let observed_key = ServerPublicKey {
            key_algorithm: server_public_key.algorithm().as_str().to_string(),
            public_key: server_public_key.public_key_base64(),
            fingerprint: server_public_key.fingerprint(HashAlg::Sha256).to_string(),
        };
        debug!(
            "ClientHandler @check_server_key host {} {} {}",
            self.host, observed_key.key_algorithm, observed_key.fingerprint
        );
        let observed_server_public_key = self.observed_server_public_key.clone();
        let pinned_server_public_keys = self.pinned_server_public_keys.clone();
        let check_server_key = self.check_server_key;
        async move {
            if check_server_key != CheckServerKey::Disabled {
                *observed_server_public_key.lock().await = Some(observed_key.clone());
            }
            Ok(SshClientHandler::verify_server_key(
                check_server_key,
                &pinned_server_public_keys,
                &observed_key,
            ))
        }
    }

    fn disconnected(
        &mut self,
        reason: DisconnectReason<Self::Error>,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send {
        async {
            debug!("ClientHandler @disconnected: {:?}", reason);
            let _ = self.tx.take().unwrap().send(true);
            match reason {
                DisconnectReason::ReceivedDisconnect(_) => Ok(()),
                DisconnectReason::Error(e) => Err(e),
            }
        }
    }
}

struct SshClient {
    id: String,
    target_id: i32,
    app_state: Arc<AppBaseState>,
}

impl SshClient {
    fn new(app_state: Arc<AppBaseState>, target_id: i32) -> Self {
        let ssh_client = SshClient {
            id: nanoid::nanoid!(),
            target_id,
            app_state,
        };

        ssh_client
    }

    async fn new_connect_timeout(
        &self,
        duration: Duration,
        tx: oneshot::Sender<bool>,
    ) -> Result<russh::client::Handle<SshClientHandler>> {
        let ssh_client_handle = tokio::select! {
            _   = tokio::time::sleep(duration) => anyhow::bail!("connect_target tiemout"),
            res = self.new_connect(tx) => res,
        }?;

        Ok(ssh_client_handle)
    }

    async fn new_connect(
        &self,
        tx: oneshot::Sender<bool>,
    ) -> Result<russh::client::Handle<SshClientHandler>> {
        let target = get_target_by_id(&self.app_state.db, self.target_id).await?;
        debug!("SshClient: {} get target: {:?}", self.id, target);

        let ssh_client_handle = self.connect_target(target, tx).await?;
        debug!("SshClient: {} target connected", self.id);

        Ok(ssh_client_handle)
    }

    async fn connect_target(
        &self,
        target: target::Model,
        tx: oneshot::Sender<bool>,
    ) -> Result<russh::client::Handle<SshClientHandler>> {
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
        let host = target.host.as_str();
        let port = target.port.unwrap_or(22);
        let pinned_server_public_keys =
            get_known_hosts_by_host_and_port(&self.app_state, host, port).await?;
        let observed_server_public_key = Arc::new(Mutex::new(None));
        let ssh_client_handler = SshClientHandler {
            host: host.to_string(),
            check_server_key: self.app_state.config.check_server_key,
            pinned_server_public_keys,
            observed_server_public_key: observed_server_public_key.clone(),
            tx: Some(tx),
        };

        let mut handle =
            russh::client::connect(Arc::new(config), (host, port), ssh_client_handler).await?;
        let auth_res = match target.method {
            TargetAuthMethod::Password => {
                let username = target.user;
                let password = target.password.unwrap_or("".to_string());
                handle.authenticate_password(username, password).await?
            }
            TargetAuthMethod::PrivateKey => {
                let username = target.user;
                let key_data = target.key.unwrap_or("".to_string());
                let private_key = decode_secret_key(&key_data, target.password.as_deref())?;
                let private_key_with_hash_alg =
                    PrivateKeyWithHashAlg::new(Arc::new(private_key), Some(HashAlg::Sha256));
                handle
                    .authenticate_publickey(username, private_key_with_hash_alg)
                    .await?
            }
            TargetAuthMethod::None => {
                anyhow::bail!("Unsupported auth method None");
            }
        };

        if !auth_res.success() {
            anyhow::bail!("Authentication failed");
        }

        let observed_server_public_key = observed_server_public_key.lock().await.clone();
        if let Some(observed_server_public_key) = observed_server_public_key {
            insert_known_host_if_missing(&self.app_state, host, port, observed_server_public_key)
                .await?;
        }

        Ok(handle)
    }
}

async fn get_known_hosts_by_host_and_port(
    app_state: &AppBaseState,
    host: &str,
    port: u16,
) -> Result<Vec<ServerPublicKey>> {
    let known_hosts = ssh_known_host::Entity::find()
        .filter(ssh_known_host::Column::Host.eq(host))
        .filter(ssh_known_host::Column::Port.eq(port))
        .all(&app_state.db)
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

async fn insert_known_host_if_missing(
    app_state: &AppBaseState,
    host: &str,
    port: u16,
    server_public_key: ServerPublicKey,
) -> Result<()> {
    let exists = ssh_known_host::Entity::find()
        .filter(ssh_known_host::Column::Host.eq(host))
        .filter(ssh_known_host::Column::Port.eq(port))
        .filter(ssh_known_host::Column::KeyAlgorithm.eq(server_public_key.key_algorithm.as_str()))
        .one(&app_state.db)
        .await?
        .is_some();

    if !exists {
        let active_model = ssh_known_host::ActiveModel {
            id: sea_orm::ActiveValue::NotSet,
            host: Set(host.to_string()),
            port: Set(port),
            key_algorithm: Set(server_public_key.key_algorithm),
            public_key: Set(server_public_key.public_key),
            fingerprint: Set(server_public_key.fingerprint),
        };
        active_model.insert(&app_state.db).await?;
    }

    Ok(())
}

struct PoolState<T> {
    idle_resources: VecDeque<T>, // 空闲资源队列
    total_count: u8,             // 已创建的资源总数
}

// 连接类型特征，用于区分SSH和SFTP连接
trait ConnectionType: Send + Sync + 'static {
    type Resource: Send + 'static;
    const TYPE_NAME: &'static str;
}

// 用于创建资源的trait
trait ResourceMaker<T: ConnectionType> {
    async fn make(&self) -> Result<T::Resource>;
}

// SSH连接类型
struct SshConnectionType;
impl ConnectionType for SshConnectionType {
    type Resource = Channel<russh::client::Msg>;
    const TYPE_NAME: &'static str = "SSH";
}

// SFTP连接类型
struct SftpConnectionType;
impl ConnectionType for SftpConnectionType {
    type Resource = FastSftpClient;
    const TYPE_NAME: &'static str = "SFTP";
}

// 泛型SSH连接，专门用于特定类型的操作
struct SshConnection<T: ConnectionType> {
    id: String,
    resource_pool_state: Mutex<PoolState<T::Resource>>,
    max_size: u8,
    client_handle: russh::client::Handle<SshClientHandler>,
    /// if expired, wait for all resources to be closed, and then close the connection
    expired: AtomicBool,
    closed: AtomicBool,
}

impl<T: ConnectionType> SshConnection<T> {
    fn new(client_handle: russh::client::Handle<SshClientHandler>, max_size: u8) -> Self {
        Self {
            id: nanoid::nanoid!(),
            resource_pool_state: Mutex::new(PoolState {
                idle_resources: VecDeque::new(),
                total_count: 0,
            }),
            max_size,
            client_handle,
            expired: AtomicBool::new(false),
            closed: AtomicBool::new(false),
        }
    }

    async fn has_idle(&self) -> bool {
        let state = self.resource_pool_state.lock().await;
        let expired = self.expired.load(Ordering::Acquire);
        let closed = self.closed.load(Ordering::Acquire);
        debug!(
            "SshConnection: {} has_idle. expired {} closed {} state.total_count {} max_size {}",
            self.id, expired, closed, state.total_count, self.max_size
        );
        !expired && !closed && state.total_count < self.max_size
    }

    async fn close_when_expired(&self) {
        let expired = self.expired.load(Ordering::Acquire);
        if expired {
            debug!("SshConnection: close_when_expired");
            self.close().await;
        }
    }

    async fn close(&self) {
        let _ = self
            .client_handle
            .disconnect(Disconnect::ByApplication, "", "English")
            .await;
        self.closed.store(true, Ordering::Release);
    }

    async fn rollback_count(&self) {
        let mut state = self.resource_pool_state.lock().await;
        if state.total_count > 0 {
            state.total_count -= 1;
            debug!(
                "SshConnection: {} rollback count {}. total_count {}",
                self.id,
                T::TYPE_NAME,
                state.total_count
            );
        }
        if state.total_count == 0 {
            self.close_when_expired().await;
        }
    }

    async fn return_resource(&self, resource: T::Resource) {
        let mut state = self.resource_pool_state.lock().await;
        if state.total_count > 0 {
            state.idle_resources.push_back(resource);

            debug!(
                "SshConnection: {} push back {}. total_count {}",
                self.id,
                T::TYPE_NAME,
                state.total_count
            );
            if state.total_count == state.idle_resources.len() as u8 {
                self.close_when_expired().await;
            }
        }
    }
}

impl<T: ConnectionType> SshConnection<T>
where
    Self: ResourceMaker<T>,
{
    async fn get_or_make(&self) -> Result<T::Resource> {
        let mut state = self.resource_pool_state.lock().await;
        let expired = self.expired.load(Ordering::Acquire);

        if expired {
            anyhow::bail!("SshConnection: {} expired", self.id);
        }

        if state.total_count >= self.max_size {
            anyhow::bail!(
                "SshConnection: {} Maximum {} limit reached",
                self.id,
                T::TYPE_NAME
            );
        }

        if let Some(resource) = state.idle_resources.pop_front() {
            debug!(
                "SshConnection: {} find idle {}. total_count {}.",
                self.id,
                T::TYPE_NAME,
                state.total_count
            );
            return Ok(resource);
        }

        state.total_count += 1;

        debug!(
            "SshConnection: {} start create {}. total_count {}.",
            self.id,
            T::TYPE_NAME,
            state.total_count
        );
        drop(state);

        let resource = self.make().await;

        if resource.is_err() {
            debug!("SshConnection: {} create {} fail.", self.id, T::TYPE_NAME);
            self.rollback_count().await;
        }
        resource
    }
}

// SSH连接类型特定实现
impl SshConnection<SshConnectionType> {
    async fn get_or_make_channel(&self) -> Result<Channel<russh::client::Msg>> {
        self.get_or_make().await
    }
}

impl ResourceMaker<SshConnectionType> for SshConnection<SshConnectionType> {
    async fn make(&self) -> Result<Channel<russh::client::Msg>> {
        let channel = self.client_handle.channel_open_session().await?;
        debug!("SshConnection: new channel {}", channel.id());
        Ok(channel)
    }
}

// SFTP连接类型特定实现
impl SshConnection<SftpConnectionType> {
    async fn get_or_make_sftp_session(&self) -> Result<FastSftpClient> {
        self.get_or_make().await
    }
}

impl ResourceMaker<SftpConnectionType> for SshConnection<SftpConnectionType> {
    async fn make(&self) -> Result<FastSftpClient> {
        let channel = self.client_handle.channel_open_session().await?;
        let channel_id = channel.id();

        let sftp = FastSftpClient::new_from_channel(channel).await?;

        debug!(
            "SshConnection: {} create FastSftpClient on SshChannel {}",
            self.id, channel_id
        );

        Ok(sftp)
    }
}

// 会话管理器，使用泛型连接
struct SshSession {
    id: String,
    connection_pool_state: Mutex<PoolState<Arc<SshConnection<SshConnectionType>>>>,
    sftp_connection_pool_state: Mutex<PoolState<Arc<SshConnection<SftpConnectionType>>>>,
    max_size: u8,
    app_state: Arc<AppBaseState>,
    client: SshClient,
    expired_ssh_connections: Mutex<Vec<Arc<SshConnection<SshConnectionType>>>>,
    expired_sftp_connections: Mutex<Vec<Arc<SshConnection<SftpConnectionType>>>>,
}

trait SessionConnectionPool<T: ConnectionType> {
    fn connection_pool_state(&self) -> &Mutex<PoolState<Arc<SshConnection<T>>>>;
}

impl SessionConnectionPool<SshConnectionType> for SshSession {
    fn connection_pool_state(&self) -> &Mutex<PoolState<Arc<SshConnection<SshConnectionType>>>> {
        &self.connection_pool_state
    }
}

impl SessionConnectionPool<SftpConnectionType> for SshSession {
    fn connection_pool_state(&self) -> &Mutex<PoolState<Arc<SshConnection<SftpConnectionType>>>> {
        &self.sftp_connection_pool_state
    }
}

impl SshSession {
    fn new(app_state: Arc<AppBaseState>, target_id: i32) -> Self {
        let app_state_clone = app_state.clone();

        SshSession {
            id: nanoid::nanoid!(),
            connection_pool_state: Mutex::new(PoolState {
                idle_resources: VecDeque::new(),
                total_count: 0,
            }),
            sftp_connection_pool_state: Mutex::new(PoolState {
                idle_resources: VecDeque::new(),
                total_count: 0,
            }),
            max_size: app_state.config.max_session_per_target,
            app_state,
            client: SshClient::new(app_state_clone, target_id),
            expired_ssh_connections: Mutex::new(Vec::new()),
            expired_sftp_connections: Mutex::new(Vec::new()),
        }
    }

    async fn get_by_id(&self, id: &str) -> Option<Arc<SshConnection<SshConnectionType>>> {
        let state = self.connection_pool_state.lock().await;
        self.inner_get_by_id(state, id)
    }

    async fn get_by_id_sftp(&self, id: &str) -> Option<Arc<SshConnection<SftpConnectionType>>> {
        let state = self.sftp_connection_pool_state.lock().await;
        self.inner_get_by_id(state, id)
    }

    // 获取或创建一个普通的的 SshConnection
    async fn get_or_make_connection(
        &self,
    ) -> Result<(
        Arc<SshConnection<SshConnectionType>>,
        Option<oneshot::Receiver<bool>>,
    )> {
        let state = self.connection_pool_state.lock().await;
        self.inner_get_or_make_connection(state, false).await
    }

    // 获取或创建一个用于 sftp 的 SshConnection
    async fn get_or_make_connection_sftp(
        &self,
    ) -> Result<(
        Arc<SshConnection<SftpConnectionType>>,
        Option<oneshot::Receiver<bool>>,
    )> {
        let state = self.sftp_connection_pool_state.lock().await;
        self.inner_get_or_make_connection(state, true).await
    }

    // 获取或创建一个 SshChannel, 并自动回收 SshConnection
    async fn get_or_make_channel(
        &self,
    ) -> Result<(
        Arc<SshConnection<SshConnectionType>>,
        Channel<russh::client::Msg>,
        Option<oneshot::Receiver<bool>>,
    )> {
        let (ssh_connection, option_rx) = self.get_or_make_connection().await?;
        let channel = ssh_connection.get_or_make_channel().await?;

        Ok((ssh_connection, channel, option_rx))
    }

    // 获取或创建一个 FastSftpClient, 并自动回收 SshConnection
    async fn get_or_make_sftp_session(
        &self,
    ) -> Result<(
        Arc<SshConnection<SftpConnectionType>>,
        FastSftpClient,
        Option<oneshot::Receiver<bool>>,
    )> {
        let (ssh_connection, option_rx) = self.get_or_make_connection_sftp().await?;
        let sftp = ssh_connection.get_or_make_sftp_session().await?;

        Ok((ssh_connection, sftp, option_rx))
    }

    // 删除 SshConnection
    async fn remove_connection(&self, connection_id: &str) {
        let future1 = self.remove_connection_ssh(connection_id);
        let future2 = self.remove_connection_sftp(connection_id);
        let future3 = self.remove_expired_connection_ssh(connection_id);
        let future4 = self.remove_expired_connection_sftp(connection_id);
        tokio::join!(future1, future2, future3, future4);
    }

    // 删除 SshConnection
    async fn remove_connection_ssh(&self, connection_id: &str) {
        let state = self.connection_pool_state.lock().await;
        self.inner_remove_connection(state, connection_id, false);
    }

    // 删除已过期的 SshConnection
    async fn remove_expired_connection_ssh(&self, connection_id: &str) {
        let state = self.expired_ssh_connections.lock().await;
        self.inner_remove_expired_connection(state, connection_id);
    }

    // 删除 SshConnection sftp
    async fn remove_connection_sftp(&self, connection_id: &str) {
        let state = self.sftp_connection_pool_state.lock().await;
        self.inner_remove_connection(state, connection_id, true);
    }

    // 删除已过期的 SshConnection sftp
    async fn remove_expired_connection_sftp(&self, connection_id: &str) {
        let state = self.expired_sftp_connections.lock().await;
        self.inner_remove_expired_connection(state, connection_id);
    }

    /// 将指定连接设置为过期，从资源池移除并放入过期连接列表
    async fn expire_connection(&self, connection_id: &str) {
        // 检查是否为普通 SSH 连接
        let ssh_conn_o = self.get_by_id(connection_id).await;
        if let Some(ssh_conn) = ssh_conn_o {
            ssh_conn.expired.store(true, Ordering::Release);
            self.remove_connection_ssh(&ssh_conn.id).await;
            let closed = ssh_conn.closed.load(Ordering::Acquire);
            if !closed {
                self.expired_ssh_connections.lock().await.push(ssh_conn);
            }
            debug!(
                "SshSession: {} SSH connection {} expired",
                self.id, connection_id
            );
            return;
        }

        // 检查是否为 SFTP 连接
        let sftp_conn_o = self.get_by_id_sftp(connection_id).await;
        if let Some(sftp_conn) = sftp_conn_o {
            sftp_conn.expired.store(true, Ordering::Release);
            self.remove_connection_sftp(&sftp_conn.id).await;
            let closed = sftp_conn.closed.load(Ordering::Acquire);
            if !closed {
                self.expired_sftp_connections.lock().await.push(sftp_conn);
            }
            debug!(
                "SshSession: {} SFTP connection {} expired",
                self.id, connection_id
            );
        }
    }

    async fn inner_get_or_make_connection<T: ConnectionType>(
        &self,
        mut state: MutexGuard<'_, PoolState<Arc<SshConnection<T>>>>,
        is_sftp: bool,
    ) -> Result<(Arc<SshConnection<T>>, Option<oneshot::Receiver<bool>>)>
    where
        Self: SessionConnectionPool<T>,
    {
        let session_id = self.id.as_str();
        debug!("SshSession: {} start find idle SshConnection.", session_id);
        // 尝试从空闲队列获取资源
        let result = async {
            let mut iter = state.idle_resources.iter();
            let mut item = iter.next();
            while let Some(resource) = item {
                item = iter.next();
                let has_idle = resource.has_idle().await;
                if has_idle {
                    debug!(
                        "SshSession: {} find idle SshConnection. idle length {}. total_count {}",
                        session_id,
                        state.idle_resources.len(),
                        state.total_count
                    );
                    return Some(resource.clone());
                }
            }
            debug!(
                "SshSession: {} no idle SshConnection. idle length {}. total_count {}",
                session_id,
                state.idle_resources.len(),
                state.total_count
            );
            None
        }
        .await;

        if let Some(resource) = result {
            return Ok((resource, None));
        }

        if state.total_count >= self.max_size {
            anyhow::bail!(
                "SshSession: {} Maximum SshConnection limit reached",
                session_id
            );
        }

        // 增加总资源计数
        state.total_count += 1;

        debug!(
            "SshSession: {} start create SshConnection. total_count {}",
            session_id, state.total_count
        );
        // 创建资源前释放锁，避免长时间持有
        drop(state);

        let resource = async {
            let (tx, rx) = oneshot::channel::<bool>();
            let client_handle = self
                .client
                .new_connect_timeout(Duration::from_secs(30), tx)
                .await?;

            let ssh_connection = Arc::new(SshConnection::new(
                client_handle,
                self.app_state.config.max_channel_per_session,
            ));

            debug!(
                "SshSession: {} SshConnection {} created.",
                session_id, ssh_connection.id
            );

            Ok((ssh_connection, Some(rx)))
        }
        .await;

        match resource {
            std::result::Result::Ok((ssh_connection, option_rx)) => {
                let state = <Self as SessionConnectionPool<T>>::connection_pool_state(self)
                    .lock()
                    .await;
                self.inner_register_connection(state, ssh_connection.clone(), is_sftp);
                Ok((ssh_connection, option_rx))
            }
            std::result::Result::Err(err) => {
                debug!("SshSession: {} create SshConnection fail.", session_id);
                let state = <Self as SessionConnectionPool<T>>::connection_pool_state(self)
                    .lock()
                    .await;
                self.inner_rollback_count_connection(state, is_sftp);
                Err(err)
            }
        }
    }

    fn inner_get_by_id<T: ConnectionType>(
        &self,
        state: MutexGuard<'_, PoolState<Arc<SshConnection<T>>>>,
        id: &str,
    ) -> Option<Arc<SshConnection<T>>> {
        state
            .idle_resources
            .iter()
            .find(|resource| resource.id == id)
            .cloned()
    }

    // 注册新建的 SshConnection
    fn inner_register_connection<T: ConnectionType>(
        &self,
        mut state: MutexGuard<'_, PoolState<Arc<SshConnection<T>>>>,
        resource: Arc<SshConnection<T>>,
        is_sftp: bool,
    ) {
        if (state.idle_resources.len() as u8) < self.max_size {
            state.idle_resources.push_back(resource);
            debug!(
                "SshSession: {} register {} SshConnection. idle length {}",
                self.id,
                if is_sftp { "sftp" } else { "default" },
                state.idle_resources.len()
            );
        }
    }

    // 删除 SshConnection
    fn inner_remove_connection<T: ConnectionType>(
        &self,
        mut state: MutexGuard<'_, PoolState<Arc<SshConnection<T>>>>,
        channel_id: &str,
        is_sftp: bool,
    ) {
        let position = state
            .idle_resources
            .iter()
            .position(|item| item.id == channel_id);

        if let Some(position) = position {
            state.idle_resources.remove(position);
            state.total_count -= 1;
            debug!(
                "SshSession: {} remove {} SshConnection. idle length {}",
                self.id,
                if is_sftp { "sftp" } else { "default" },
                state.idle_resources.len()
            );
        }
    }

    /// 回滚 SshConnection 计数
    fn inner_rollback_count_connection<T: ConnectionType>(
        &self,
        mut state: MutexGuard<'_, PoolState<Arc<SshConnection<T>>>>,
        is_sftp: bool,
    ) {
        if state.total_count > 0 {
            state.total_count -= 1;
            debug!(
                "SshSession: {} rollback count {} SshConnection. total_count {}",
                self.id,
                if is_sftp { "sftp" } else { "default" },
                state.total_count
            );
        }
    }

    // 从过期的连接列表中删除连接
    fn inner_remove_expired_connection<T: ConnectionType>(
        &self,
        mut state: MutexGuard<'_, Vec<Arc<SshConnection<T>>>>,
        channel_id: &str,
    ) {
        let position = state.iter().position(|item| item.id == channel_id);

        if let Some(position) = position {
            state.remove(position);
            debug!("SshSession: {} remove expired SshConnection.", self.id);
        }
    }
}

// 类型安全的守护结构
pub struct SshChannelGuard {
    channel: Option<Channel<russh::client::Msg>>,
    pool: Arc<SshConnection<SshConnectionType>>,
    closed: bool,
    transferred: bool,
}

impl SshChannelGuard {
    // 代理Channel的wait方法，如果接收到Close消息，则将guard标记为已关闭不可复用
    pub async fn wait(&mut self) -> Option<ChannelMsg> {
        if let Some(channel) = self.channel.as_mut() {
            let msg = channel.wait().await;
            debug!("SshChannelGuard: {} @wait msg {:?}", self.pool.id, msg);
            if msg.is_none() {
                self.closed = true;
            }
            msg
        } else {
            None
        }
    }

    pub fn split(mut self) -> Option<(ChannelReadHalf, ChannelWriteHalf<russh::client::Msg>)> {
        if let Some(channel) = self.channel.take() {
            Some(channel.split())
        } else {
            None
        }
    }

    pub fn into_stream(mut self) -> Option<SshChannelStreamGuard> {
        self.transferred = true;
        self.pool.expired.store(true, Ordering::Release);
        self.channel.take().map(|channel| SshChannelStreamGuard {
            stream: Some(channel.into_stream()),
            pool: self.pool.clone(),
        })
    }

    pub fn into_split(
        mut self,
    ) -> Option<(
        ChannelReadHalf,
        ChannelWriteHalf<russh::client::Msg>,
        SshChannelTransferGuard,
    )> {
        self.transferred = true;
        self.pool.expired.store(true, Ordering::Release);
        self.channel.take().map(|channel| {
            let (reader, writer) = channel.split();
            (
                reader,
                writer,
                SshChannelTransferGuard {
                    pool: self.pool.clone(),
                },
            )
        })
    }
}

impl Drop for SshChannelGuard {
    fn drop(&mut self) {
        let channel_o = self.channel.take();
        let pool = self.pool.clone();
        let closed = self.closed;
        let transferred = self.transferred;
        let connection_closed = pool.closed.load(Ordering::Acquire);
        if connection_closed {
            return;
        }
        tokio::spawn(async move {
            if transferred {
                return;
            }
            if !closed && let Some(channel) = channel_o {
                pool.return_resource(channel).await;
            } else {
                pool.rollback_count().await;
            }
        });
    }
}

impl std::ops::Deref for SshChannelGuard {
    type Target = Channel<russh::client::Msg>;

    fn deref(&self) -> &Self::Target {
        self.channel.as_ref().unwrap()
    }
}

impl std::ops::DerefMut for SshChannelGuard {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.channel.as_mut().unwrap()
    }
}

pub struct SshChannelStreamGuard {
    stream: Option<ChannelStream<russh::client::Msg>>,
    pool: Arc<SshConnection<SshConnectionType>>,
}

pub struct SshChannelTransferGuard {
    pool: Arc<SshConnection<SshConnectionType>>,
}

impl Drop for SshChannelTransferGuard {
    fn drop(&mut self) {
        let pool = self.pool.clone();
        if pool.closed.load(Ordering::Acquire) {
            return;
        }
        tokio::spawn(async move {
            pool.rollback_count().await;
            pool.close_when_expired().await;
        });
    }
}

impl Drop for SshChannelStreamGuard {
    fn drop(&mut self) {
        let _ = self.stream.take();
        let pool = self.pool.clone();
        let connection_closed = pool.closed.load(Ordering::Acquire);
        if connection_closed {
            return;
        }
        tokio::spawn(async move {
            pool.rollback_count().await;
            pool.close_when_expired().await;
        });
    }
}

impl AsyncRead for SshChannelStreamGuard {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        Pin::new(this.stream.as_mut().expect("ssh channel stream missing")).poll_read(cx, buf)
    }
}

impl AsyncWrite for SshChannelStreamGuard {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        let this = self.get_mut();
        Pin::new(this.stream.as_mut().expect("ssh channel stream missing")).poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        Pin::new(this.stream.as_mut().expect("ssh channel stream missing")).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        Pin::new(this.stream.as_mut().expect("ssh channel stream missing")).poll_shutdown(cx)
    }
}

pub struct SftpClientGuard {
    sftp_client: Option<FastSftpClient>,
    pool: Arc<SshConnection<SftpConnectionType>>,
}

impl Drop for SftpClientGuard {
    fn drop(&mut self) {
        let sftp_client = self.sftp_client.take().unwrap();
        let pool = self.pool.clone();
        let connection_closed = pool.closed.load(Ordering::Acquire);
        if connection_closed {
            return;
        }
        tokio::spawn(async move {
            sftp_client.shutdown().await;
            pool.rollback_count().await;
        });
    }
}

impl std::ops::Deref for SftpClientGuard {
    type Target = FastSftpClient;

    fn deref(&self) -> &Self::Target {
        &self.sftp_client.as_ref().unwrap()
    }
}

/// 连接信息汇总，用于 list_all_connections 返回
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ConnectionInfo {
    /// SSH 连接 ID
    pub id: String,
    /// 连接是否已过期
    pub expired: bool,
    /// 连接是否已关闭
    pub closed: bool,
    /// 连接类型名称
    pub type_name: String,
    /// 关联的 SSH 目标 ID
    pub target_id: i32,
}

pub(crate) struct SshSessionPool {
    session_pool_map: Mutex<HashMap<i32, Arc<SshSession>>>,
    app_state: Arc<AppBaseState>,
}

impl SshSessionPool {
    pub fn new(app_state: Arc<AppBaseState>) -> Self {
        SshSessionPool {
            session_pool_map: Mutex::new(HashMap::new()),
            app_state,
        }
    }

    async fn get_session(&self, target_id: i32) -> Result<Arc<SshSession>> {
        let ssh_session = {
            let mut guard = self.session_pool_map.lock().await;

            let arc_pool = guard
                .entry(target_id)
                .or_insert_with(|| {
                    let ssh_session = Arc::new(SshSession::new(self.app_state.clone(), target_id));
                    debug!(
                        "SshSessionPool: target {} creating SshSession {}",
                        target_id, ssh_session.id
                    );
                    ssh_session
                })
                .clone();

            arc_pool
        };

        debug!(
            "SshSessionPool: target {} get SshSession {}",
            target_id, ssh_session.id
        );

        Ok(ssh_session)
    }

    pub async fn get_channel(&self, target_id: i32) -> Result<SshChannelGuard> {
        let ssh_session = self.get_session(target_id).await?;
        let (ssh_connection, channel, rx_option) = ssh_session.get_or_make_channel().await?;

        drop_connection_received_msg(ssh_session, &ssh_connection, rx_option);

        debug!(
            "SshSessionPool: target {} get SshChannel {}",
            target_id,
            channel.id()
        );

        Ok(SshChannelGuard {
            channel: Some(channel),
            pool: ssh_connection,
            closed: false,
            transferred: false,
        })
    }

    pub async fn get_sftp_session(&self, target_id: i32) -> Result<SftpClientGuard> {
        let ssh_session = self.get_session(target_id).await?;
        let (ssh_connection, sftp_session, rx_option) =
            ssh_session.get_or_make_sftp_session().await?;

        drop_connection_received_msg(ssh_session, &ssh_connection, rx_option);

        debug!("SshSessionPool: target {} get FastSftpClient", target_id);

        Ok(SftpClientGuard {
            sftp_client: Some(sftp_session),
            pool: ssh_connection,
        })
    }

    #[allow(dead_code)]
    pub async fn expire_connection(&self, target_id: i32, connection_id: &str) {
        let ssh_session_o = self.session_pool_map.lock().await.get(&target_id).cloned();
        if let Some(ssh_session) = ssh_session_o {
            ssh_session.expire_connection(connection_id).await;
        }
    }

    pub async fn list_all_connections(&self, target_filter: Option<i32>) -> Vec<ConnectionInfo> {
        let guard = self.session_pool_map.lock().await;
        let mut result: Vec<ConnectionInfo> = Vec::new();

        for (target_id, session) in guard.iter() {
            if target_filter.is_some() && target_filter.unwrap() != *target_id {
                continue;
            }

            // active ssh connections
            let conn_state = session.connection_pool_state.lock().await;
            for conn in conn_state.idle_resources.iter() {
                result.push(ConnectionInfo {
                    id: conn.id.clone(),
                    expired: conn.expired.load(Ordering::Acquire),
                    closed: conn.closed.load(Ordering::Acquire),
                    type_name: <SshConnectionType as ConnectionType>::TYPE_NAME.to_string(),
                    target_id: *target_id,
                });
            }
            drop(conn_state);

            // active sftp connections
            let sftp_state = session.sftp_connection_pool_state.lock().await;
            for conn in sftp_state.idle_resources.iter() {
                result.push(ConnectionInfo {
                    id: conn.id.clone(),
                    expired: conn.expired.load(Ordering::Acquire),
                    closed: conn.closed.load(Ordering::Acquire),
                    type_name: <SftpConnectionType as ConnectionType>::TYPE_NAME.to_string(),
                    target_id: *target_id,
                });
            }
            drop(sftp_state);

            // expired ssh connections
            let expired_ssh = session.expired_ssh_connections.lock().await;
            for conn in expired_ssh.iter() {
                result.push(ConnectionInfo {
                    id: conn.id.clone(),
                    expired: conn.expired.load(Ordering::Acquire),
                    closed: conn.closed.load(Ordering::Acquire),
                    type_name: <SshConnectionType as ConnectionType>::TYPE_NAME.to_string(),
                    target_id: *target_id,
                });
            }
            drop(expired_ssh);

            // expired sftp connections
            let expired_sftp = session.expired_sftp_connections.lock().await;
            for conn in expired_sftp.iter() {
                result.push(ConnectionInfo {
                    id: conn.id.clone(),
                    expired: conn.expired.load(Ordering::Acquire),
                    closed: conn.closed.load(Ordering::Acquire),
                    type_name: <SftpConnectionType as ConnectionType>::TYPE_NAME.to_string(),
                    target_id: *target_id,
                });
            }
            drop(expired_sftp);
        }

        result
    }
}

fn drop_connection_received_msg<T: ConnectionType>(
    ssh_session: Arc<SshSession>,
    ssh_connection: &Arc<SshConnection<T>>,
    rx_option: Option<oneshot::Receiver<bool>>,
) {
    if rx_option.is_some() {
        let connection_clone = ssh_connection.clone();
        let ssh_session_clone = ssh_session.clone();
        let rx = rx_option.unwrap();
        tokio::spawn(async move {
            match rx.await {
                std::result::Result::Ok(v) => {
                    debug!(
                        "SshSessionPool: SSH SshConnection {} disconnected, signal: {:?}",
                        connection_clone.id, v
                    );
                    connection_clone.close().await;
                    ssh_session_clone
                        .remove_connection(&connection_clone.id)
                        .await;
                }
                Err(_) => debug!(
                    "SshSessionPool: SSH SshConnection {} the sender dropped",
                    connection_clone.id
                ),
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{config::Config, migrations::Migrator, tests::sftp_server};
    use sea_orm::{ActiveModelTrait, Database, EntityTrait};
    use sea_orm_migration::MigratorTrait;
    use tokio::{
        sync::{OnceCell, broadcast},
        time::sleep,
    };
    use tracing_subscriber::fmt;

    static INIT_ONCE_CELL: OnceCell<(Arc<SshSessionPool>, broadcast::Sender<String>)> =
        OnceCell::const_new();
    async fn init() -> &'static (Arc<SshSessionPool>, broadcast::Sender<String>) {
        INIT_ONCE_CELL
            .get_or_init(|| async {
                let _ = fmt().with_env_filter("server=debug,off").init();

                let config = Config {
                    max_session_per_target: 2,
                    max_channel_per_session: 3,
                    transfer_task_concurrency: 3,
                    transfer_chunk_size: 10 * 1024 * 1024,
                    check_server_key: CheckServerKey::AcceptNew,
                };

                let db = Database::connect("sqlite::memory:")
                    .await
                    .expect("Database connection failed");

                Migrator::up(&db, None).await.unwrap();

                let active_model = target::ActiveModel::from(target::Model {
                    id: 1,
                    host: "127.0.0.1".to_string(),
                    port: Some(2222),
                    method: target::TargetAuthMethod::Password,
                    user: "root".to_string(),
                    key: None,
                    password: Some("123456".to_string()),
                    system: Some("windows".to_string()),
                });
                let _ = active_model.insert(&db).await.unwrap();
                let app_state = Arc::new(AppBaseState { db, config });
                let session_pool = Arc::new(SshSessionPool::new(app_state.clone()));

                let disconnect_tx = sftp_server::run_server().await.unwrap();

                (session_pool, disconnect_tx)
            })
            .await
    }

    async fn exec(mut channel: SshChannelGuard, cmd: &str) -> (SshChannelGuard, String) {
        let _ = channel.exec(true, cmd).await;
        let mut buf = Vec::<u8>::new();
        loop {
            tokio::select! {
                _   = tokio::time::sleep(Duration::from_secs(1)) => break,
                result = channel.wait() => {
                    let Some(msg) = result else {
                        break;
                    };
                    match msg {
                        // Write data to the terminal
                        ChannelMsg::Data { ref data } => {
                            buf.extend_from_slice(data);
                        }
                        _ => {}
                    }
                },
            };
        }
        (channel, String::from_utf8(buf).unwrap())
    }

    #[test]
    fn test_verify_server_key_config() {
        let observed_key = ServerPublicKey {
            key_algorithm: "ssh-ed25519".to_string(),
            public_key: "observed".to_string(),
            fingerprint: "SHA256:observed".to_string(),
        };
        let pinned_key = observed_key.clone();
        let changed_key = ServerPublicKey {
            key_algorithm: "ssh-ed25519".to_string(),
            public_key: "changed".to_string(),
            fingerprint: "SHA256:changed".to_string(),
        };

        assert!(SshClientHandler::verify_server_key(
            CheckServerKey::AcceptNew,
            &[],
            &observed_key
        ));
        assert!(!SshClientHandler::verify_server_key(
            CheckServerKey::Strict,
            &[],
            &observed_key
        ));
        assert!(SshClientHandler::verify_server_key(
            CheckServerKey::Disabled,
            &[],
            &observed_key
        ));
        assert!(SshClientHandler::verify_server_key(
            CheckServerKey::Strict,
            &[pinned_key],
            &observed_key
        ));
        assert!(!SshClientHandler::verify_server_key(
            CheckServerKey::AcceptNew,
            &[changed_key],
            &observed_key
        ));
    }

    #[tokio::test]
    async fn test_ssh_session_pool() {
        test_ssh_session_pool_channel_guard().await;
        test_ssh_session_pool_expire_connection().await;
        test_ssh_session_pool_expire_sftp_connection().await;
        test_ssh_session_pool_disconnect_connection().await;
    }

    // 测试连接池状态
    async fn test_ssh_session_pool_connection_pool_state(
        session: Arc<SshSession>,
    ) -> Arc<SshConnection<SshConnectionType>> {
        let connection_pool_state = session.connection_pool_state.lock().await;
        let ssh_connection = connection_pool_state.idle_resources.get(0).unwrap().clone();
        assert_eq!(
            connection_pool_state.total_count, 1,
            "expeceted 1 connection"
        );
        assert_eq!(
            connection_pool_state.idle_resources.len(),
            1,
            "expeceted 1 connection"
        );
        drop(connection_pool_state);

        ssh_connection
    }

    async fn test_ssh_session_pool_channel_guard() {
        let (session_pool, _) = init().await;
        let channel_guard = session_pool.get_channel(1).await.unwrap();
        let known_hosts = ssh_known_host::Entity::find()
            .all(&session_pool.app_state.db)
            .await
            .unwrap();
        assert_eq!(known_hosts.len(), 1, "expected 1 known host");
        let session = session_pool.get_session(1).await.unwrap();
        let connection = test_ssh_session_pool_connection_pool_state(session.clone()).await;

        // guard销毁，关闭的channel 自动 roll back
        let (channel_guard, result_msg) = exec(channel_guard, "close_channel").await;
        assert_eq!(result_msg, "exec close_channel done");
        drop(channel_guard);
        sleep(Duration::from_secs(1)).await;
        let state = connection.resource_pool_state.lock().await;
        assert_eq!(state.total_count, 0);
        drop(state);

        // guard销毁，未关闭的channel 自动 push back
        let channel_guard = session_pool.get_channel(1).await.unwrap();
        let connection = test_ssh_session_pool_connection_pool_state(session.clone()).await;
        let (channel_guard, result_msg) = exec(channel_guard, "hello").await;
        assert_eq!(result_msg, "exec hello done");
        drop(channel_guard);
        sleep(Duration::from_secs(1)).await;
        let state = connection.resource_pool_state.lock().await;
        assert_eq!(state.total_count, 1);
        drop(state);
    }

    /// 测试将一个连接设置为过期，过期的连接已经不在连接池中，该连接下的channel仍可用，等channel都关闭后，连接会自动销毁
    async fn test_ssh_session_pool_expire_connection() {
        let (session_pool, _) = init().await;

        let channel = session_pool.get_channel(1).await.unwrap();

        // 获取上面创建的connection id,测试连接池状态
        let session = session_pool.get_session(1).await.unwrap();
        let connection = test_ssh_session_pool_connection_pool_state(session.clone()).await;
        let connection_id = connection.id.clone();

        let _ = session_pool
            .expire_connection(1, connection_id.as_str())
            .await;

        // 已过期的连接，在session中找不到了
        let result = session.get_by_id(connection_id.as_str()).await;
        assert!(result.is_none());

        // 过期的连接下所有channel都回收了，连接自动销毁
        drop(channel);
        sleep(Duration::from_secs(1)).await;
        let state = session.connection_pool_state.lock().await;
        assert!(state.idle_resources.is_empty());
        assert_eq!(state.total_count, 0);
        drop(state);
    }

    /// 测试将一个连接设置为过期，过期的连接已经不在连接池中，该连接下的channel仍可用，等channel都关闭后，连接会自动销毁
    async fn test_ssh_session_pool_expire_sftp_connection() {
        let (session_pool, _) = init().await;

        let sftp_guard = session_pool.get_sftp_session(1).await.unwrap();

        let read_dir = sftp_guard.read_dir("/").await.unwrap();
        let file_names: Vec<String> = read_dir
            .into_iter()
            .map(|dir_entry| dir_entry.file_name().to_string())
            .collect();
        assert_eq!(
            file_names,
            vec!["foo", "bar"],
            "sftp read_dir unexpected result"
        );

        // 获取上面创建的connection id,测试连接池状态
        let session = session_pool.get_session(1).await.unwrap();
        let connection_pool_state = session.sftp_connection_pool_state.lock().await;
        let connection = connection_pool_state.idle_resources.get(0).unwrap().clone();
        let connection_id = connection.id.clone();
        assert_eq!(
            connection_pool_state.total_count, 1,
            "expeceted 1 connection"
        );
        assert_eq!(
            connection_pool_state.idle_resources.len(),
            1,
            "expeceted 1 connection"
        );
        drop(connection_pool_state);

        let _ = session_pool
            .expire_connection(1, connection_id.as_str())
            .await;

        // 已过期的连接，在session中找不到了
        let result = session.get_by_id_sftp(connection_id.as_str()).await;
        assert!(result.is_none());

        // 过期的连接下的 SftpClientGuard 仍然可用
        let read_dir = sftp_guard.read_dir("/").await.unwrap();
        let file_names: Vec<String> = read_dir
            .into_iter()
            .map(|dir_entry| dir_entry.file_name().to_string())
            .collect();
        assert_eq!(
            file_names,
            vec!["foo", "bar"],
            "sftp read_dir unexpected result"
        );

        // 过期的连接下所有channel都回收了，连接自动销毁
        drop(sftp_guard);
        sleep(Duration::from_secs(1)).await;
        let state = connection.resource_pool_state.lock().await;
        assert_eq!(state.total_count, 0);
        assert!(state.idle_resources.is_empty());
        drop(state);
        assert!(connection.closed.load(Ordering::Acquire));
    }

    /// 测试ssh server断开连接后，断开的连接已经不在连接池中
    async fn test_ssh_session_pool_disconnect_connection() {
        let (session_pool, disconnect_tx) = init().await;

        let channel = session_pool.get_channel(1).await.unwrap();
        let (_, result_msg) = exec(channel, "hello").await;
        assert_eq!(result_msg, "exec hello done");

        // 获取上面创建的connection id,测试连接池状态
        let session = session_pool.get_session(1).await.unwrap();
        let connection = test_ssh_session_pool_connection_pool_state(session.clone()).await;
        let connection_id = connection.id.clone();

        // 被动断开的连接，在session中找不到了
        let _ = disconnect_tx.send("disconnect".to_string()).unwrap();
        sleep(Duration::from_secs(1)).await;
        let result = session.get_by_id(connection_id.as_str()).await;
        assert!(result.is_none());
    }
}
