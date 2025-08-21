use std::{
    collections::{HashMap, VecDeque},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use anyhow::{Ok, Result};
use russh::{
    Disconnect,
    client::DisconnectReason,
    keys::{HashAlg, PrivateKeyWithHashAlg, PublicKeyBase64, decode_secret_key, ssh_key},
};
use russh_sftp::client::SftpSession;
use tokio::sync::{Mutex, oneshot};
use tracing::debug;

use crate::{
    AppBaseState,
    apis::target::get_target_by_id,
    entities::target::{self, TargetAuthMethod},
};

struct SshClientHandler {
    host: String,
    tx: Option<oneshot::Sender<bool>>,
}

impl russh::client::Handler for SshClientHandler {
    type Error = anyhow::Error;

    fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send {
        debug!(
            "ClientHandler @check_server_key {} {:?}",
            self.host,
            server_public_key.public_key_base64()
        );
        async { Ok(true) }
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
        let config = russh::client::Config::default();
        let ssh_client_handler = SshClientHandler {
            host: target.host.clone(),
            tx: Some(tx),
        };

        let mut handle = russh::client::connect(
            Arc::new(config),
            (target.host, target.port.unwrap_or(22)),
            ssh_client_handler,
        )
        .await?;
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

        Ok(handle)
    }
}

struct PoolState<T> {
    idle_resources: VecDeque<T>, // 空闲资源队列
    total_count: u8,             // 已创建的资源总数
}

struct SshSession {
    id: String,
    connection_pool_state: Mutex<PoolState<Arc<SshConnection>>>,
    max_size: u8,
    app_state: Arc<AppBaseState>,
    client: SshClient,
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
            max_size: app_state.config.max_session_per_target,
            app_state,
            client: SshClient::new(app_state_clone, target_id),
        }
    }

    async fn get_by_id(&self, id: &str) -> Option<Arc<SshConnection>> {
        let state = self.connection_pool_state.lock().await;
        state
            .idle_resources
            .iter()
            .find(|resource| resource.id == id)
            .cloned()
    }

    // 获取或创建一个 SshConnection
    async fn get_or_make(&self) -> Result<(Arc<SshConnection>, Option<oneshot::Receiver<bool>>)> {
        let mut state = self.connection_pool_state.lock().await;

        debug!("SshSession: {} start find idle SshConnection.", self.id);
        // 尝试从空闲队列获取资源
        let result = async {
            let mut iter = state.idle_resources.iter().enumerate();
            let mut item = iter.next();
            while let Some((index, resource)) = item {
                item = iter.next();
                let has_idle = resource.has_idle().await;
                if has_idle {
                    debug!(
                        "SshSession: {} find idle SshConnection. idle length {}. total_count {}",
                        self.id,
                        state.idle_resources.len(),
                        state.total_count
                    );
                    return state.idle_resources.remove(index);
                }
            }
            debug!(
                "SshSession: {} no idle SshConnection. idle length {}. total_count {}",
                self.id,
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
                self.id
            );
        }

        // 增加总资源计数
        state.total_count += 1;

        debug!(
            "SshSession: {} start create SshConnection. total_count {}",
            self.id, state.total_count
        );
        // 创建资源前释放锁，避免长时间持有
        drop(state);

        let resource = async {
            let (tx, rx) = oneshot::channel::<bool>();
            let client_handle = self
                .client
                .new_connect_timeout(Duration::from_secs(30), tx)
                .await?;

            let ssh_connection =
                Arc::new(SshConnection::new(self.app_state.clone(), client_handle));

            Ok((ssh_connection, Some(rx)))
        }
        .await;

        if resource.is_err() {
            debug!("SshSession: {} create SshConnection fail.", self.id);
            // 创建失败，回滚计数
            self.rollback_count().await;
        } else {
            debug!("SshSession: {} SshConnection created.", self.id);
        }

        resource
    }

    // 获取或创建一个 SshChannel, 并自动回收 SshConnection
    async fn get_or_make_channel(
        &self,
    ) -> Result<(
        Arc<SshConnection>,
        russh::Channel<russh::client::Msg>,
        Option<oneshot::Receiver<bool>>,
    )> {
        let (ssh_connection, option_rx) = self.get_or_make().await?;
        let ssh_connection_clone = ssh_connection.clone();
        let channel = match ssh_connection.get_or_make().await {
            std::result::Result::Ok(channel) => {
                self.return_resource(ssh_connection).await;
                Ok(channel)
            }
            Err(err) => {
                self.return_resource(ssh_connection).await;
                Err(err)
            }
        }?;

        Ok((ssh_connection_clone, channel, option_rx))
    }

    // 回收 SshConnection
    async fn return_resource(&self, resource: Arc<SshConnection>) {
        let mut state = self.connection_pool_state.lock().await;
        if (state.idle_resources.len() as u8) < self.max_size {
            state.idle_resources.push_back(resource);
            debug!(
                "SshSession: {} push back SshConnection. idle length {}",
                self.id,
                state.idle_resources.len()
            );
        }
    }

    // 删除 SshConnection
    async fn remove_resource(&self, channel_id: &str) {
        let mut state = self.connection_pool_state.lock().await;
        let position = state
            .idle_resources
            .iter()
            .position(|item| item.id == channel_id);

        if let Some(position) = position {
            state.idle_resources.remove(position);
            state.total_count -= 1;
            debug!(
                "SshSession: {} remove SshConnection. idle length {}",
                self.id,
                state.idle_resources.len()
            );
        }
    }

    /// 回滚计数
    pub async fn rollback_count(&self) {
        let mut state = self.connection_pool_state.lock().await;
        if state.total_count > 0 {
            state.total_count -= 1;
            debug!(
                "SshSession: {} rollback count. total_count {}",
                self.id, state.total_count
            );
        }
    }
}

pub struct SshConnection {
    id: String,
    channel_pool_state: Mutex<PoolState<russh::Channel<russh::client::Msg>>>,
    max_size: u8,
    client_handle: russh::client::Handle<SshClientHandler>,
    #[allow(dead_code)]
    /// if expired, wait for all channel to be closed, and then close the connection
    expired: AtomicBool,
}

impl SshConnection {
    fn new(
        app_state: Arc<AppBaseState>,
        client_handle: russh::client::Handle<SshClientHandler>,
    ) -> Self {
        Self {
            id: nanoid::nanoid!(),
            channel_pool_state: Mutex::new(PoolState {
                idle_resources: VecDeque::new(),
                total_count: 0,
            }),
            max_size: app_state.config.max_channel_per_session,
            client_handle,
            expired: AtomicBool::new(false),
        }
    }

    async fn get_or_make(&self) -> Result<russh::Channel<russh::client::Msg>> {
        let mut state = self.channel_pool_state.lock().await;
        let expired = self.expired.load(Ordering::Acquire);

        if expired {
            anyhow::bail!("SshConnection: {} expired", self.id);
        }

        if state.total_count >= self.max_size {
            anyhow::bail!("SshConnection: {} Maximum Channel limit reached", self.id);
        }

        // 增加总资源计数
        state.total_count += 1;

        debug!(
            "SshConnection: {} start create Channel. total_count {}.",
            self.id, state.total_count
        );
        // 创建资源前释放锁，避免长时间持有
        drop(state);

        let resource = async {
            let channel = self.client_handle.channel_open_session().await?;
            debug!("SshConnection: new channel {}", channel.id());
            Ok(channel)
        }
        .await;

        if resource.is_err() {
            debug!("SshConnection: {} create Channel fail.", self.id);
            // 创建失败，回滚计数
            self.rollback_count().await;
        } else {
            debug!("SshConnection: {} Channel created.", self.id);
        }
        resource
    }

    /// 回滚计数
    async fn rollback_count(&self) {
        let mut state = self.channel_pool_state.lock().await;
        if state.total_count > 0 {
            state.total_count -= 1;
            debug!(
                "SshConnection: {} drop Channel. total_count {}",
                self.id, state.total_count
            );
        } else {
            let expired = self.expired.load(Ordering::Acquire);
            if expired {
                // 关闭没有channel的过期的SshConnection
                self.close().await;
            }
        }
    }

    async fn has_idle(&self) -> bool {
        let state = self.channel_pool_state.lock().await;
        let expired = self.expired.load(Ordering::Acquire);
        expired == false && state.total_count < self.max_size
    }

    async fn close(&self) {
        let _ = self
            .client_handle
            .disconnect(Disconnect::ByApplication, "", "English")
            .await;
    }
}

impl Drop for SshConnection {
    fn drop(&mut self) {
        debug!("SshConnection: {} drop", self.id);
    }
}

pub struct SshChannelGuard {
    channel: Option<russh::Channel<russh::client::Msg>>,
    pool: Arc<SshConnection>,
}

impl SshChannelGuard {
    pub fn take_channel(&mut self) -> Option<russh::Channel<russh::client::Msg>> {
        self.channel.take()
    }
}

impl Drop for SshChannelGuard {
    fn drop(&mut self) {
        let pool = self.pool.clone();
        tokio::spawn(async move {
            pool.rollback_count().await;
        });
    }
}

impl std::ops::Deref for SshChannelGuard {
    type Target = russh::Channel<russh::client::Msg>;

    fn deref(&self) -> &Self::Target {
        self.channel.as_ref().unwrap()
    }
}

impl std::ops::DerefMut for SshChannelGuard {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.channel.as_mut().unwrap()
    }
}

pub struct SshSftpSession {
    target_id: i32,
    sftp_session: SftpSession,
}

impl std::ops::Deref for SshSftpSession {
    type Target = SftpSession;

    fn deref(&self) -> &Self::Target {
        &self.sftp_session
    }
}

struct SshSftpSessionPool {
    pool_state: Mutex<PoolState<Arc<SshSftpSession>>>,
    max_size: u8,
}

impl SshSftpSessionPool {
    fn new(app_state: Arc<AppBaseState>) -> Self {
        SshSftpSessionPool {
            pool_state: Mutex::new(PoolState {
                idle_resources: VecDeque::new(),
                total_count: 0,
            }),
            max_size: app_state.config.max_channel_per_session / 2
                * (app_state.config.max_session_per_target / 2),
        }
    }

    /// 创建或获取一个sftp会话
    async fn get_or_make(
        &self,
        target_id: i32,
        ssh_session: Arc<SshSession>,
    ) -> Result<Arc<SshSftpSession>> {
        let mut state = self.pool_state.lock().await;
        let mut sessions = state
            .idle_resources
            .iter()
            .filter(|item| item.target_id == target_id);

        let position = sessions.position(|item| item.target_id == target_id);

        if position.is_some() {
            debug!(
                "SshSftpSessionPool: target {} find idle SftpSession",
                target_id
            );

            return Ok(state.idle_resources.remove(position.unwrap()).unwrap());
        }

        let count = sessions.count() as u8;
        drop(state);

        if count >= self.max_size {
            anyhow::bail!("SshSftpSessionPool: Maximum SshSftpSession limit reached");
        }

        self.make(target_id, ssh_session).await
    }

    /// 创建一个sftp会话
    async fn make(
        &self,
        target_id: i32,
        ssh_session: Arc<SshSession>,
    ) -> Result<Arc<SshSftpSession>> {
        let (ssh_connection, channel, rx_option) = ssh_session.get_or_make_channel().await?;
        let channel_id = channel.id();
        drop_connection_received_msg(ssh_session, &ssh_connection, rx_option);

        // request subsystem sftp
        channel.request_subsystem(true, "sftp").await?;
        // create SftpSession
        let sftp = SftpSession::new(channel.into_stream()).await?;

        debug!(
            "SshSftpSessionPool: target {} create SftpSession on SshChannel {}",
            target_id, channel_id
        );

        Ok(Arc::new(SshSftpSession {
            target_id,
            sftp_session: sftp,
        }))
    }

    async fn return_resource(&self, resource: Arc<SshSftpSession>) {
        let mut state = self.pool_state.lock().await;
        state.idle_resources.push_back(resource);

        debug!(
            "SshSftpSessionPool: push back SshSftpSession. idle length {}",
            state.idle_resources.len()
        );
    }
}

pub struct SftpSessionGuard {
    sftp_session: Arc<SshSftpSession>,
    pool: Arc<SshSftpSessionPool>,
}

impl Drop for SftpSessionGuard {
    fn drop(&mut self) {
        let sftp_session = self.sftp_session.clone();
        let pool = self.pool.clone();
        tokio::spawn(async move {
            let _ = pool.return_resource(sftp_session).await;
        });
    }
}

impl std::ops::Deref for SftpSessionGuard {
    type Target = Arc<SshSftpSession>;

    fn deref(&self) -> &Self::Target {
        &self.sftp_session
    }
}

pub struct SshSessionPool {
    session_pool_map: Mutex<HashMap<i32, Arc<SshSession>>>,
    sftp_session_pool: Arc<SshSftpSessionPool>,
    app_state: Arc<AppBaseState>,
}

impl SshSessionPool {
    pub fn new(app_state: Arc<AppBaseState>) -> Self {
        SshSessionPool {
            session_pool_map: Mutex::new(HashMap::new()),
            sftp_session_pool: Arc::new(SshSftpSessionPool::new(app_state.clone())),
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

    /// 借用一个SshChannel, 用完自动回收待复用，
    /// 如果通过SshChannelGuard::take_channel()获取所有权，则不会回收，需要手动关闭channel
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
        })
    }

    pub async fn get_sftp_session(&self, target_id: i32) -> Result<SftpSessionGuard> {
        let ssh_session = self.get_session(target_id).await?;
        let ssh_sftp_session = self
            .sftp_session_pool
            .get_or_make(target_id, ssh_session)
            .await?;

        debug!("SshSessionPool: target {} get SftpSession", target_id);

        Ok(SftpSessionGuard {
            sftp_session: ssh_sftp_session,
            pool: self.sftp_session_pool.clone(),
        })
    }

    #[allow(dead_code)]
    // 将指定的SshConnection标记为过期，将等待没有消费的时候，自动关闭
    pub async fn expire_connection(&self, target_id: i32, connection_id: &str) {
        let ssh_session_o = self.session_pool_map.lock().await.get(&target_id).cloned();
        if ssh_session_o.is_none() {
            return;
        }
        let ssh_session = ssh_session_o.unwrap();
        let ssh_connection_o = ssh_session.get_by_id(connection_id).await;
        if let Some(ssh_connection) = ssh_connection_o {
            ssh_connection.expired.store(true, Ordering::Release);
            ssh_session.remove_resource(&ssh_connection.id).await;
        }
    }
}

/// 接收到消息时，销毁SshConnection
fn drop_connection_received_msg(
    ssh_session: Arc<SshSession>,
    ssh_connection: &Arc<SshConnection>,
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
                        "SshSessionPool: SshChannel {} disconnected, signal: {:?}",
                        connection_clone.id, v
                    );
                    connection_clone.close().await;
                    ssh_session_clone
                        .remove_resource(&connection_clone.id)
                        .await;
                }
                Err(_) => debug!(
                    "SshSessionPool: SshChannel {} the sender dropped",
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
    use russh::ChannelMsg;
    use sea_orm::{ActiveModelTrait, Database};
    use sea_orm_migration::MigratorTrait;
    use tokio::{
        sync::{OnceCell, broadcast},
        time::sleep,
    };
    use tracing::info;
    use tracing_subscriber::fmt;

    static INIT_ONCE_CELL: OnceCell<(Arc<SshSessionPool>, broadcast::Sender<String>)> =
        OnceCell::const_new();
    async fn init() -> &'static (Arc<SshSessionPool>, broadcast::Sender<String>) {
        INIT_ONCE_CELL
            .get_or_init(|| async {
                let _ = fmt().with_env_filter("server=debug,off").init();

                let config = Config {
                    max_session_per_target: 2,
                    max_channel_per_session: 2,
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

    #[tokio::test]
    /// 测试将一个连接设置为过期，过期的连接已经不在连接池中，该连接下的channel仍可用，等channel都关闭后，连接会自动销毁
    async fn test_ssh_session_pool_expire_connection() {
        let (session_pool, _) = init().await;

        let sftp_guard = session_pool.get_sftp_session(1).await.unwrap();
        let read_dir = sftp_guard.read_dir("/").await.unwrap();

        let file_names: Vec<String> = read_dir.map(|dir_entry| dir_entry.file_name()).collect();
        assert_eq!(
            file_names,
            vec!["foo", "bar"],
            "sftp read_dir unexpected result"
        );

        let session = session_pool.get_session(1).await.unwrap();
        let (ssh_connection, _) = session.get_or_make().await.unwrap();
        let connection_id = ssh_connection.id.clone();
        session.return_resource(ssh_connection.clone()).await;

        let _ = session_pool
            .expire_connection(1, connection_id.as_str())
            .await;

        let result = session.get_by_id(connection_id.as_str()).await;
        assert!(result.is_none());

        // 过期的连接下的channel仍然可用
        let read_dir = sftp_guard.read_dir("/").await.unwrap();
        let file_names: Vec<String> = read_dir.map(|dir_entry| dir_entry.file_name()).collect();
        assert_eq!(
            file_names,
            vec!["foo", "bar"],
            "sftp read_dir unexpected result"
        );

        let mut channel = session_pool.get_channel(1).await.unwrap();
        let _ = channel.exec(true, "hello").await;
        let mut buf = Vec::<u8>::new();
        if let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { ref data } => {
                    buf.extend_from_slice(data);
                }
                _ => {}
            }
            let msg_str = String::from_utf8_lossy(&buf);
            info!("channel message: {:?}", msg_str);
        } else {
            info!("channel message: None");
        }

        // TODO: 测试所有channel回收后，连接会自动销毁
        // 销毁channel
        // drop(sftp_guard);
        // ssh_connection.close().await;
        // sleep(Duration::from_secs(1)).await;
        // let state = ssh_connection.channel_pool_state.lock().await;
        // assert_eq!(state.total_count, 1);
        // drop(state);
    }

    #[tokio::test]
    /// 测试ssh server断开连接后，断开的连接已经不在连接池中
    async fn test_ssh_session_pool_disconnect_connection() {
        let (session_pool, disconnect_tx) = init().await;

        let sftp_guard = session_pool.get_sftp_session(1).await.unwrap();
        let read_dir = sftp_guard.read_dir("/").await.unwrap();

        let file_names: Vec<String> = read_dir.map(|dir_entry| dir_entry.file_name()).collect();
        assert_eq!(
            file_names,
            vec!["foo", "bar"],
            "sftp read_dir unexpected result"
        );

        // 获取已创建的connection_id
        let session = session_pool.get_session(1).await.unwrap();
        let (ssh_connection, _) = session.get_or_make().await.unwrap();
        let connection_id = ssh_connection.id.clone();
        session.return_resource(ssh_connection).await;

        let _ = disconnect_tx.send("disconnect".to_string()).unwrap();

        sleep(Duration::from_secs(1)).await;
        let result = session.get_by_id(connection_id.as_str()).await;
        assert!(result.is_none());
    }
}
