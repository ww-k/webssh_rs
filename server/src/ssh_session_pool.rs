use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, atomic::AtomicBool},
    time::Duration,
};

use anyhow::{Ok, Result};
use russh::{
    Disconnect,
    client::DisconnectReason,
    keys::{HashAlg, PrivateKeyWithHashAlg, PublicKeyBase64, decode_secret_key, ssh_key},
};
use russh_sftp::client::SftpSession;
use tokio::sync::Mutex;
use tracing::debug;

use crate::{
    AppBaseState,
    apis::target::get_target_by_id,
    entities::target::{self, TargetAuthMethod},
};

struct SshClientHandler {
    host: String,
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
            // TODO: 通知SshSession, 将SshConnection标记为关闭，并回滚计数
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
    ) -> Result<russh::client::Handle<SshClientHandler>> {
        let ssh_client_handle = tokio::select! {
            _   = tokio::time::sleep(duration) => anyhow::bail!("connect_target tiemout"),
            res = self.new_connect() => res,
        }?;

        Ok(ssh_client_handle)
    }

    async fn new_connect(&self) -> Result<russh::client::Handle<SshClientHandler>> {
        let target = get_target_by_id(&self.app_state.db, self.target_id).await?;
        debug!("SshClient: {} get target: {:?}", self.id, target);

        let ssh_client_handle = self.connect_target(target).await?;
        debug!("SshClient: {} target connected", self.id);

        Ok(ssh_client_handle)
    }

    async fn connect_target(
        &self,
        target: target::Model,
    ) -> Result<russh::client::Handle<SshClientHandler>> {
        let config = russh::client::Config::default();
        let ssh_client_handler = SshClientHandler {
            host: target.host.clone(),
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
                todo!();
            }
        };

        if !auth_res.success() {
            anyhow::bail!("Authentication failed");
        }

        Ok(handle)
    }

    #[allow(dead_code)]
    async fn close(
        &self,
        ssh_client_handle: russh::client::Handle<SshClientHandler>,
    ) -> Result<()> {
        ssh_client_handle
            .disconnect(Disconnect::ByApplication, "", "English")
            .await?;
        Ok(())
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

    async fn get_or_make(&self) -> Result<Arc<SshConnection>> {
        let mut state = self.connection_pool_state.lock().await;

        debug!("SshSession: {} start find idle resource.", self.id);
        // 尝试从空闲队列获取资源
        let result = async {
            let mut iter = state.idle_resources.iter().enumerate();
            let mut item = iter.next();
            while let Some((index, resource)) = item {
                item = iter.next();
                let has_idle = resource.has_idle().await;
                if has_idle {
                    let resource = state.idle_resources.remove(index);
                    debug!(
                        "SshSession: {} find idle resource. idle length {}. total_count {}",
                        self.id,
                        state.idle_resources.len(),
                        state.total_count
                    );
                    return resource;
                }
            }
            debug!(
                "SshSession: {} no idle resource. idle length {}. total_count {}",
                self.id,
                state.idle_resources.len(),
                state.total_count
            );
            None
        }
        .await;

        if let Some(resource) = result {
            return Ok(resource);
        }

        if state.total_count >= self.max_size {
            anyhow::bail!("SshSession: {} Maximum resource limit reached", self.id);
        }

        // 增加总资源计数
        state.total_count += 1;

        debug!(
            "SshSession: {} start create resource. total_count {}",
            self.id, state.total_count
        );
        // 创建资源前释放锁，避免长时间持有
        drop(state);

        let resource = async {
            let client_handle = self
                .client
                .new_connect_timeout(Duration::from_secs(30))
                .await?;

            let ssh_channel_pool = Arc::new(SshConnection {
                id: nanoid::nanoid!(),
                channel_pool_state: Mutex::new(PoolState {
                    idle_resources: VecDeque::new(),
                    total_count: 0,
                }),
                max_size: self.app_state.config.max_channel_per_session,
                client_handle,
                expired: AtomicBool::new(false),
            });
            debug!(
                "SshSession {} creating SshConnection {}",
                self.id, ssh_channel_pool.id
            );
            Ok(ssh_channel_pool)
        }
        .await;

        if resource.is_err() {
            debug!("SshSession: {} create resource fail.", self.id);
            // 创建失败，回滚计数
            self.rollback_count().await;
        } else {
            debug!("SshSession: {} resource created.", self.id);
        }
        resource
    }

    async fn return_resource(&self, resource: Arc<SshConnection>) {
        let mut state = self.connection_pool_state.lock().await;
        if (state.idle_resources.len() as u8) < self.max_size {
            state.idle_resources.push_back(resource);
            debug!(
                "SshSession: {} push back resource. idle length {}",
                self.id,
                state.idle_resources.len()
            );
        }
    }

    /// 创建失败，回滚计数
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

    #[allow(dead_code)]
    pub async fn expire_resource(&self) {
        todo!()
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
    async fn get(&self) -> Result<russh::Channel<russh::client::Msg>> {
        let mut state = self.channel_pool_state.lock().await;

        if state.total_count >= self.max_size {
            anyhow::bail!("SshConnection: {} Maximum resource limit reached", self.id);
        }

        // 增加总资源计数
        state.total_count += 1;

        debug!(
            "SshConnection: {} start create resource. total_count {}",
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
            debug!("SshConnection: {} create resource fail.", self.id);
            // 创建失败，释放资源
            self.drop_resource().await;
        } else {
            debug!("SshConnection: {} resource created.", self.id);
        }
        resource
    }

    async fn return_resource(&self, resource: russh::Channel<russh::client::Msg>) {
        let mut state = self.channel_pool_state.lock().await;
        if (state.idle_resources.len() as u8) < self.max_size {
            state.idle_resources.push_back(resource);
            debug!(
                "SshConnection: {} push back resource. idle length {}",
                self.id,
                state.idle_resources.len()
            );
        }
    }

    async fn drop_resource(&self) {
        let mut state = self.channel_pool_state.lock().await;
        if state.total_count > 0 {
            state.total_count -= 1;
            debug!(
                "SshConnection: {} drop resource. total_count {}",
                self.id, state.total_count
            );
        }
    }

    async fn has_idle(&self) -> bool {
        let state = self.channel_pool_state.lock().await;
        state.total_count < self.max_size
    }
}

/// 资源守卫，使用 RAII 确保资源归还
pub struct SshConnectionGuard {
    resource: Arc<SshConnection>,
    pool: Arc<SshSession>,
}

impl Drop for SshConnectionGuard {
    fn drop(&mut self) {
        let pool = self.pool.clone();
        let resource = self.resource.clone();
        tokio::spawn(async move {
            pool.return_resource(resource).await;
        });
    }
}

impl std::ops::Deref for SshConnectionGuard {
    type Target = Arc<SshConnection>;

    fn deref(&self) -> &Self::Target {
        &self.resource
    }
}

pub struct SshChannelGuard {
    channel: Option<russh::Channel<russh::client::Msg>>,
    pool: SshConnectionGuard,
}

impl SshChannelGuard {
    pub fn take_channel(&mut self) -> Option<russh::Channel<russh::client::Msg>> {
        self.channel.take()
    }
}

impl Drop for SshChannelGuard {
    fn drop(&mut self) {
        let pool = self.pool.clone();
        let resource = self.take_channel();
        tokio::spawn(async move {
            if resource.is_none() {
                pool.drop_resource().await;
            } else {
                let resource = resource.unwrap();
                pool.return_resource(resource).await;
            }
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
}

impl SshSftpSessionPool {
    fn new() -> Self {
        SshSftpSessionPool {
            pool_state: Mutex::new(PoolState {
                idle_resources: VecDeque::new(),
                total_count: 0,
            }),
        }
    }

    async fn get(&self, target_id: i32) -> Option<Arc<SshSftpSession>> {
        let mut state = self.pool_state.lock().await;
        let position = state
            .idle_resources
            .iter()
            .position(|item| item.target_id == target_id);

        match position {
            Some(position) => state.idle_resources.remove(position),
            None => None,
        }
    }
    async fn return_resource(&self, resource: Arc<SshSftpSession>) {
        let mut state = self.pool_state.lock().await;
        state.idle_resources.push_back(resource);

        debug!(
            "SshSftpSessionPool: push back resource. idle length {}",
            state.idle_resources.len()
        );
    }
}

pub struct SftpSessionGuard {
    sftp_session: Arc<SshSftpSession>,
    // ssh_connection_guard: SshConnectionGuard,
    pool: Arc<SshSftpSessionPool>,
}

impl Drop for SftpSessionGuard {
    fn drop(&mut self) {
        // let channel_pool = self.ssh_connection_guard.clone();
        let sftp_session = self.sftp_session.clone();
        let pool = self.pool.clone();
        tokio::spawn(async move {
            let _ = pool.return_resource(sftp_session).await;
            //TODO: 回滚channel的计数
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
            sftp_session_pool: Arc::new(SshSftpSessionPool::new()),
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

    /// 借用一个SshConnection, 用完后自动回收待复用
    pub async fn get_connection(&self, target_id: i32) -> Result<SshConnectionGuard> {
        let ssh_session = self.get_session(target_id).await?;

        let ssh_connection = ssh_session.get_or_make().await?;
        let ssh_connection_guard = SshConnectionGuard {
            resource: ssh_connection,
            pool: ssh_session,
        };

        debug!(
            "SshSessionPool: target {} get SshConnection {}",
            target_id, ssh_connection_guard.id
        );

        Ok(ssh_connection_guard)
    }

    /// 借用一个SshChannel, 用完自动回收待复用，
    /// 如果通过SshChannelGuard::take_channel()获取所有权，则不会回收，需要手动关闭channel
    pub async fn get_channel(&self, target_id: i32) -> Result<SshChannelGuard> {
        let ssh_connection_guard = self.get_connection(target_id).await?;

        let ssh_channel = ssh_connection_guard.get().await?;
        debug!(
            "SshSessionPool: target {} get SshChannel {}",
            target_id,
            ssh_channel.id()
        );

        Ok(SshChannelGuard {
            channel: Some(ssh_channel),
            //TODO: ssh_channel没释放，connetion也不会释放
            pool: ssh_connection_guard,
        })
    }

    pub async fn get_sftp_session(&self, target_id: i32) -> Result<SftpSessionGuard> {
        let sftp = self.sftp_session_pool.get(target_id).await;
        if sftp.is_some() {
            return Ok(SftpSessionGuard {
                sftp_session: sftp.unwrap(),
                pool: self.sftp_session_pool.clone(),
            });
        }

        let ssh_connection_guard = self.get_connection(target_id).await?;
        let channel = ssh_connection_guard.get().await?;
        channel.request_subsystem(true, "sftp").await?;
        let channel_id = channel.id();
        let sftp = SftpSession::new(channel.into_stream()).await?;

        debug!(
            "SshSessionPool: target {} get SftpSession on SshChannel {}",
            target_id, channel_id
        );

        // TODO: channel没有释放计数
        Ok(SftpSessionGuard {
            sftp_session: Arc::new(SshSftpSession {
                target_id,
                sftp_session: sftp,
            }),
            pool: self.sftp_session_pool.clone(),
        })
    }

    #[allow(dead_code)]
    // 将指定的SshConnection标记为过期，将等待没有消费的时候，自动关闭
    pub async fn expire_connection(&self /*target_id: i32, id: &str*/) {
        todo!()
    }
}
