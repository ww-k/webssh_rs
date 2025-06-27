use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
    time::Duration,
};

use anyhow::{Ok, Result};
use russh::{
    Disconnect,
    client::DisconnectReason,
    keys::{HashAlg, PrivateKeyWithHashAlg, PublicKeyBase64, decode_secret_key, ssh_key},
};
use sea_orm::EntityTrait;
use tokio::sync::Mutex;
use tracing::debug;

use crate::{
    AppState,
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
    app_state: Arc<AppState>,
}

impl SshClient {
    fn new(app_state: Arc<AppState>, target_id: i32) -> Self {
        let ssh_session = SshClient {
            id: nanoid::nanoid!(),
            target_id,
            app_state,
        };

        ssh_session
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
        let target = self.get_target().await?;
        debug!("SshClient: {} get target: {:?}", self.id, target);

        let ssh_client_handle = self.connect_target(target).await?;
        debug!("SshClient: {} target connected", self.id);

        Ok(ssh_client_handle)
    }

    async fn get_target(&self) -> Result<target::Model> {
        let result = target::Entity::find_by_id(self.target_id)
            .one(&self.app_state.db)
            .await;

        if let Err(db_err) = result {
            anyhow::bail!("Failed to get target {:?}", db_err);
        }

        let model = result.unwrap();
        if model.is_none() {
            anyhow::bail!("no target found");
        }

        Ok(model.unwrap())
    }

    async fn connect_target(
        &self,
        target: target::Model,
    ) -> Result<russh::client::Handle<SshClientHandler>> {
        let config = russh::client::Config::default();
        let handler = SshClientHandler {
            host: target.host.clone(),
        };

        let mut session = russh::client::connect(
            Arc::new(config),
            (target.host, target.port.unwrap_or(22)),
            handler,
        )
        .await?;
        let auth_res = match target.method {
            TargetAuthMethod::Password => {
                let username = target.user;
                let password = target.password.unwrap_or("".to_string());
                session.authenticate_password(username, password).await?
            }
            TargetAuthMethod::PrivateKey => {
                let username = target.user;
                let key_data = target.key.unwrap_or("".to_string());
                let private_key = decode_secret_key(&key_data, target.password.as_deref())?;
                let private_key_with_hash_alg =
                    PrivateKeyWithHashAlg::new(Arc::new(private_key), Some(HashAlg::Sha256));
                session
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

        Ok(session)
    }

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

struct SshConnectionPool {
    id: String,
    state: Mutex<PoolState<Arc<SshChannelPool>>>,
    max_size: u8,
    app_state: Arc<AppState>,
    client: SshClient,
}

impl SshConnectionPool {
    fn new(app_state: Arc<AppState>, target_id: i32) -> Self {
        let app_state_clone = app_state.clone();
        SshConnectionPool {
            id: nanoid::nanoid!(),
            state: Mutex::new(PoolState {
                idle_resources: VecDeque::new(),
                total_count: 0,
            }),
            max_size: app_state.config.max_session_per_target,
            app_state,
            client: SshClient::new(app_state_clone, target_id),
        }
    }

    async fn get_async(&self) -> Result<Arc<SshChannelPool>> {
        let mut state = self.state.lock().await;

        debug!("SshConnectionPool: {} start find idle resource.", self.id);
        // 尝试从空闲队列获取资源
        let result = async {
            let mut iter = state.idle_resources.iter().enumerate();
            let mut item = iter.next();
            while let Some((index, resource)) = item {
                item = iter.next();
                let has_idle = resource.has_idle().await;
                if has_idle {
                    let resource = state.idle_resources.remove(index);
                    debug!("SshConnectionPool: {} find idle resource.", self.id);
                    return resource;
                }
            }
            debug!("SshConnectionPool: {} no idle resource.", self.id);
            None
        }
        .await;

        if let Some(resource) = result {
            return Ok(resource);
        }

        if state.total_count >= self.max_size {
            anyhow::bail!(
                "SshConnectionPool: {} Maximum resource limit reached",
                self.id
            );
        }

        // 增加总资源计数
        state.total_count += 1;

        debug!(
            "SshConnectionPool: {} start create resource. total_count {}",
            self.id, state.total_count
        );
        // 创建资源前释放锁，避免长时间持有
        drop(state);

        let resource = async {
            let ssh_session = self
                .client
                .new_connect_timeout(Duration::from_secs(30))
                .await?;

            let ssh_channel_pool = Arc::new(SshChannelPool {
                id: nanoid::nanoid!(),
                state: Mutex::new(PoolState {
                    idle_resources: VecDeque::new(),
                    total_count: 0,
                }),
                max_size: self.app_state.config.max_channel_per_session,
                ssh_session,
            });
            debug!(
                "SshConnectionPool {} creating SshChannelPool {}",
                self.id, ssh_channel_pool.id
            );
            Ok(ssh_channel_pool)
        }
        .await;

        if resource.is_err() {
            debug!("SshConnectionPool: {} create resource fail.", self.id);
            // 创建失败，释放资源
            self.drop_resource().await;
        } else {
            debug!("SshConnectionPool: {} resource created.", self.id);
        }
        resource
    }

    async fn return_resource(&self, resource: Arc<SshChannelPool>) {
        let mut state = self.state.lock().await;
        if (state.idle_resources.len() as u8) < self.max_size {
            state.idle_resources.push_back(resource);
            debug!(
                "SshConnectionPool: {} push back resource. idle length {}",
                self.id,
                state.idle_resources.len()
            );
        }
    }

    /// 对于不能复用的资源，比如ssh channel，调用此方法释放资源池的统计数量
    pub async fn drop_resource(&self) {
        let mut state = self.state.lock().await;
        if state.total_count > 0 {
            state.total_count -= 1;
            debug!(
                "SshConnectionPool: {} drop resource. total_count {}",
                self.id, state.total_count
            );
        }
    }
}

struct SshChannelPool {
    id: String,
    state: Mutex<PoolState<russh::Channel<russh::client::Msg>>>,
    max_size: u8,
    ssh_session: russh::client::Handle<SshClientHandler>,
}

impl SshChannelPool {
    async fn get_async(&self) -> Result<russh::Channel<russh::client::Msg>> {
        let mut state = self.state.lock().await;

        if state.total_count >= self.max_size {
            anyhow::bail!("SshChannelPool: {} Maximum resource limit reached", self.id);
        }

        // 增加总资源计数
        state.total_count += 1;

        debug!(
            "SshChannelPool: {} start create resource. total_count {}",
            self.id, state.total_count
        );
        // 创建资源前释放锁，避免长时间持有
        drop(state);

        let resource = async {
            let channel = self.ssh_session.channel_open_session().await?;
            debug!("SshChannelPool: new channel {}", channel.id());
            Ok(channel)
        }
        .await;

        if resource.is_err() {
            debug!("SshChannelPool: {} create resource fail.", self.id);
            // 创建失败，释放资源
            self.drop_resource().await;
        } else {
            debug!("SshChannelPool: {} resource created.", self.id);
        }
        resource
    }

    async fn drop_resource(&self) {
        let mut state = self.state.lock().await;
        if state.total_count > 0 {
            state.total_count -= 1;
            debug!(
                "SshChannelPool: {} drop resource. total_count {}",
                self.id, state.total_count
            );
        }
    }

    async fn has_idle(&self) -> bool {
        let state = self.state.lock().await;
        state.total_count < self.max_size
    }
}

/// 资源守卫，使用 RAII 确保资源归还
struct SshSessionGuard {
    resource: Option<Arc<SshChannelPool>>,
    pool: Arc<SshConnectionPool>,
}

impl Drop for SshSessionGuard {
    fn drop(&mut self) {
        let pool = self.pool.clone();
        let resource = self.resource.take().unwrap();
        tokio::spawn(async move {
            pool.return_resource(resource).await;
        });
    }
}

impl std::ops::Deref for SshSessionGuard {
    type Target = Arc<SshChannelPool>;

    fn deref(&self) -> &Self::Target {
        self.resource.as_ref().unwrap()
    }
}

impl std::ops::DerefMut for SshSessionGuard {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.resource.as_mut().unwrap()
    }
}

pub struct SshChannelGuard {
    channel: Option<russh::Channel<russh::client::Msg>>,
    pool: SshSessionGuard,
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
            pool.drop_resource().await;
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

pub struct SshSessionPool {
    session_pool_map: Mutex<HashMap<i32, Arc<SshConnectionPool>>>,
    app_state: Arc<AppState>,
}

impl SshSessionPool {
    pub fn new(app_state: Arc<AppState>) -> Self {
        SshSessionPool {
            session_pool_map: Mutex::new(HashMap::new()),
            app_state,
        }
    }

    pub async fn get(&self, target_id: i32) -> Result<SshChannelGuard> {
        let ssh_session_pool = {
            let mut guard = self.session_pool_map.lock().await;

            let arc_pool = guard
                .entry(target_id)
                .or_insert_with(|| {
                    let ssh_session_pool =
                        Arc::new(SshConnectionPool::new(self.app_state.clone(), target_id));
                    debug!(
                        "SshSessionPool: target {} creating SshConnectionPool {}",
                        target_id, ssh_session_pool.id
                    );
                    ssh_session_pool
                })
                .clone();

            arc_pool
        };

        debug!(
            "SshSessionPool: target {} get SshConnectionPool {}",
            target_id, ssh_session_pool.id
        );

        let ssh_channel_pool = ssh_session_pool.get_async().await?;
        let ssh_session_guard = SshSessionGuard {
            resource: Some(ssh_channel_pool),
            pool: ssh_session_pool.clone(),
        };

        debug!(
            "SshSessionPool: target {} get SshChannelPool {}",
            target_id, ssh_session_guard.id
        );

        let ssh_channel = ssh_session_guard.get_async().await?;
        debug!(
            "SshSessionPool: target {} get SshChannel {}",
            target_id,
            ssh_channel.id()
        );

        ssh_session_pool
            .return_resource(ssh_session_guard.clone())
            .await;

        debug!(
            "SshSessionPool: target {} return SshChannelPool {}",
            target_id,
            ssh_channel.id()
        );

        Ok(SshChannelGuard {
            channel: Some(ssh_channel),
            pool: ssh_session_guard,
        })
    }
}
