pub mod dto;
pub mod handlers;

use std::{collections::HashMap, sync::Arc};

use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    sea_query::Expr,
};
use tokio::{io::copy_bidirectional, net::TcpListener, sync::Mutex, task::JoinHandle};
use tracing::{debug, info, warn};

use crate::{
    apis::ApiErr,
    consts::services_err_code::{ERR_CODE_DB_ERR, ERR_CODE_PORT_FORWARD, ERR_CODE_SSH_ERR},
    entities::port_forward,
    map_db_err,
    ssh_connection_pool::SshConnectionPool,
};

use dto::{PortForwardInfo, PortForwardPayload, PortForwardUpdatePayload};

struct PortForwardTask {
    info: PortForwardInfo,
    task: Option<JoinHandle<()>>,
}

pub struct PortForwardManager {
    db: DatabaseConnection,
    connection_pool: Arc<SshConnectionPool>,
    tasks: Mutex<HashMap<String, PortForwardTask>>,
}

impl PortForwardManager {
    pub(crate) fn new(db: DatabaseConnection, connection_pool: Arc<SshConnectionPool>) -> Self {
        Self {
            db,
            connection_pool,
            tasks: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) async fn load(&self) -> Result<(), ApiErr> {
        map_db_err!(
            port_forward::Entity::update_many()
                .col_expr(port_forward::Column::Enabled, Expr::value(false))
                .exec(&self.db)
                .await
        )?;
        let rows = map_db_err!(port_forward::Entity::find().all(&self.db).await)?;
        info!(
            count = rows.len(),
            "port forwarding configurations loaded; listeners remain disabled until manually enabled"
        );
        let mut tasks = self.tasks.lock().await;
        for row in rows {
            tasks.insert(
                row.id.clone(),
                PortForwardTask {
                    info: PortForwardInfo {
                        id: row.id,
                        local_host: row.local_host,
                        local_port: row.local_port,
                        remote_host: row.remote_host,
                        remote_port: row.remote_port,
                        target_id: row.target_id,
                        enabled: false,
                    },
                    task: None,
                },
            );
        }
        Ok(())
    }

    pub(crate) async fn reload(&self) -> Result<(), ApiErr> {
        let mut tasks = self.tasks.lock().await;
        for item in tasks.values_mut() {
            if let Some(task) = item.task.take() {
                task.abort();
            }
        }
        tasks.clear();
        drop(tasks);
        self.load().await
    }

    pub async fn list(&self) -> Vec<PortForwardInfo> {
        let mut items: Vec<_> = self
            .tasks
            .lock()
            .await
            .values()
            .map(|item| item.info.clone())
            .collect();
        items.sort_by_key(|item| item.local_port);
        items
    }

    pub async fn create(&self, payload: PortForwardPayload) -> Result<PortForwardInfo, ApiErr> {
        if payload.local_port == 0 || payload.remote_port == 0 {
            return Err(ApiErr {
                code: ERR_CODE_PORT_FORWARD,
                message: "local_port and remote_port must be between 1 and 65535".into(),
            });
        }
        let remote_host = payload.remote_host.trim().to_string();
        if remote_host.is_empty() {
            return Err(ApiErr {
                code: ERR_CODE_PORT_FORWARD,
                message: "remote_host must not be empty".into(),
            });
        }
        let local_host = payload.local_host.trim().to_string();
        if local_host.is_empty() {
            return Err(ApiErr {
                code: ERR_CODE_PORT_FORWARD,
                message: "local_host must not be empty".into(),
            });
        }

        self.connection_pool
            .context(payload.target_id)
            .await
            .map_err(|err| ApiErr {
                code: ERR_CODE_SSH_ERR,
                message: err.to_string(),
            })?;

        let id = nanoid::nanoid!();
        let info = PortForwardInfo {
            id: id.clone(),
            local_host,
            local_port: payload.local_port,
            remote_host: remote_host.clone(),
            remote_port: payload.remote_port,
            target_id: payload.target_id,
            enabled: true,
        };
        let task = self.start_listener(&info).await?;
        let model = port_forward::ActiveModel {
            id: Set(info.id.clone()),
            target_id: Set(info.target_id),
            local_host: Set(info.local_host.clone()),
            local_port: Set(info.local_port),
            remote_host: Set(info.remote_host.clone()),
            remote_port: Set(info.remote_port),
            enabled: Set(true),
        };
        if let Err(err) = map_db_err!(model.insert(&self.db).await) {
            task.abort();
            return Err(err);
        }
        info!(
            "forward_id={} forwarding enabled local={}:{} remote={}:{} target_id={}",
            info.id,
            info.local_host,
            info.local_port,
            info.remote_host,
            info.remote_port,
            info.target_id
        );
        self.tasks.lock().await.insert(
            id,
            PortForwardTask {
                info: info.clone(),
                task: Some(task),
            },
        );
        Ok(info)
    }

    async fn start_listener(&self, info: &PortForwardInfo) -> Result<JoinHandle<()>, ApiErr> {
        let listener = TcpListener::bind((info.local_host.as_str(), info.local_port))
            .await
            .map_err(|err| ApiErr {
                code: ERR_CODE_PORT_FORWARD,
                message: format!("failed to bind local port {}: {err}", info.local_port),
            })?;
        self.connection_pool
            .context(info.target_id)
            .await
            .map_err(|err| ApiErr {
                code: ERR_CODE_SSH_ERR,
                message: err.to_string(),
            })?
            .connect()
            .await
            .map_err(|err| ApiErr {
                code: ERR_CODE_SSH_ERR,
                message: err.to_string(),
            })?;
        info!(
            "forward_id={} listener started local={}:{} remote={}:{} target_id={}",
            info.id,
            info.local_host,
            info.local_port,
            info.remote_host,
            info.remote_port,
            info.target_id
        );
        let connection_pool = Arc::clone(&self.connection_pool);
        let target_id = info.target_id;
        let remote_host = info.remote_host.clone();
        let remote_port = info.remote_port;
        let local_host = info.local_host.clone();
        let local_port = info.local_port;
        let forward_id = info.id.clone();
        Ok(tokio::spawn(async move {
            loop {
                let (mut local, peer) = match listener.accept().await {
                    Ok(value) => value,
                    Err(err) => {
                        debug!(
                            "forward_id={} listener stopped local_port={} error={}",
                            forward_id, local_port, err
                        );
                        break;
                    }
                };
                info!(
                    "forward_id={} connection accepted peer={}",
                    forward_id, peer
                );
                let pool = Arc::clone(&connection_pool);
                let forward_id = forward_id.clone();
                let remote_host = remote_host.clone();
                let local_host = local_host.clone();
                tokio::spawn(async move {
                    let context = match pool.context(target_id).await {
                        Ok(context) => context,
                        Err(err) => {
                            warn!(
                                "forward_id={} unable to create SSH context target_id={} error={}",
                                forward_id, target_id, err
                            );
                            drop(local);
                            info!(
                                "forward_id={} connection disconnected peer={}",
                                forward_id, peer
                            );
                            return;
                        }
                    };
                    let mut remote = match context
                        .direct_tcpip(&remote_host, remote_port, &local_host)
                        .await
                    {
                        Ok(remote) => remote,
                        Err(err) => {
                            warn!(
                                "forward_id={} unable to open forwarding channel remote={}:{} target_id={} error={}",
                                forward_id, remote_host, remote_port, target_id, err
                            );
                            drop(local);
                            info!(
                                "forward_id={} connection disconnected peer={}",
                                forward_id, peer
                            );
                            return;
                        }
                    };
                    info!(
                        "forward_id={} forwarding channel opened peer={} remote={}:{} target_id={}",
                        forward_id, peer, remote_host, remote_port, target_id
                    );
                    let copy_result = copy_bidirectional(&mut local, &mut remote).await;
                    drop(remote);
                    match copy_result {
                        Ok((uploaded, downloaded)) => info!(
                            "forward_id={} forwarding channel disconnected and released peer={} target_id={} uploaded={} downloaded={}",
                            forward_id, peer, target_id, uploaded, downloaded
                        ),
                        Err(err) => info!(
                            "forward_id={} forwarding channel disconnected and released peer={} target_id={} error={}",
                            forward_id, peer, target_id, err
                        ),
                    }
                    drop(local);
                    info!(
                        "forward_id={} connection disconnected peer={}",
                        forward_id, peer
                    );
                });
            }
        }))
    }

    pub async fn toggle(&self, id: &str, enabled: bool) -> Result<PortForwardInfo, ApiErr> {
        let current = {
            let tasks = self.tasks.lock().await;
            tasks.get(id).map(|item| item.info.clone())
        }
        .ok_or_else(|| ApiErr {
            code: ERR_CODE_PORT_FORWARD,
            message: "port forwarding entry not found".into(),
        })?;

        if current.enabled == enabled {
            return Ok(current);
        }

        if !enabled {
            let mut tasks = self.tasks.lock().await;
            let item = tasks.get_mut(id).ok_or_else(|| ApiErr {
                code: ERR_CODE_PORT_FORWARD,
                message: "port forwarding entry not found".into(),
            })?;
            if let Some(task) = item.task.take() {
                task.abort();
            }
            item.info.enabled = false;
            map_db_err!(
                port_forward::Entity::update_many()
                    .col_expr(port_forward::Column::Enabled, Expr::value(false))
                    .filter(port_forward::Column::Id.eq(id))
                    .exec(&self.db)
                    .await
            )?;
            info!("forward_id={} forwarding disabled", id);
            return Ok(item.info.clone());
        }

        let task = self.start_listener(&current).await?;
        let mut tasks = self.tasks.lock().await;
        let item = match tasks.get_mut(id) {
            Some(item) => item,
            None => {
                task.abort();
                return Err(ApiErr {
                    code: ERR_CODE_PORT_FORWARD,
                    message: "port forwarding entry not found".into(),
                });
            }
        };
        item.task = Some(task);
        item.info.enabled = true;
        map_db_err!(
            port_forward::Entity::update_many()
                .col_expr(port_forward::Column::Enabled, Expr::value(true))
                .filter(port_forward::Column::Id.eq(id))
                .exec(&self.db)
                .await
        )?;
        info!("forward_id={} forwarding enabled", id);
        Ok(item.info.clone())
    }

    pub async fn update(
        &self,
        payload: PortForwardUpdatePayload,
    ) -> Result<PortForwardInfo, ApiErr> {
        if payload.local_port == 0 || payload.remote_port == 0 {
            return Err(ApiErr {
                code: ERR_CODE_PORT_FORWARD,
                message: "local_port and remote_port must be between 1 and 65535".into(),
            });
        }
        let local_host = payload.local_host.trim().to_string();
        let remote_host = payload.remote_host.trim().to_string();
        if local_host.is_empty() || remote_host.is_empty() {
            return Err(ApiErr {
                code: ERR_CODE_PORT_FORWARD,
                message: "local_host and remote_host must not be empty".into(),
            });
        }
        self.connection_pool
            .context(payload.target_id)
            .await
            .map_err(|err| ApiErr {
                code: ERR_CODE_SSH_ERR,
                message: err.to_string(),
            })?;

        let old = {
            let mut tasks = self.tasks.lock().await;
            let item = tasks.get_mut(&payload.id).ok_or_else(|| ApiErr {
                code: ERR_CODE_PORT_FORWARD,
                message: "port forwarding entry not found".into(),
            })?;
            let old = item.info.clone();
            if let Some(task) = item.task.take() {
                task.abort();
            }
            item.info.enabled = false;
            old
        };
        let mut updated = PortForwardInfo {
            id: payload.id.clone(),
            local_host,
            local_port: payload.local_port,
            remote_host,
            remote_port: payload.remote_port,
            target_id: payload.target_id,
            enabled: old.enabled,
        };
        let new_task = if old.enabled {
            match self.start_listener(&updated).await {
                Ok(task) => Some(task),
                Err(err) => {
                    let restore_task = self.start_listener(&old).await.ok();
                    let mut tasks = self.tasks.lock().await;
                    if let Some(item) = tasks.get_mut(&payload.id) {
                        item.info = old.clone();
                        item.info.enabled = restore_task.is_some();
                        item.task = restore_task;
                    }
                    return Err(err);
                }
            }
        } else {
            None
        };
        let mut tasks = self.tasks.lock().await;
        let item = tasks.get_mut(&payload.id).ok_or_else(|| ApiErr {
            code: ERR_CODE_PORT_FORWARD,
            message: "port forwarding entry not found".into(),
        })?;
        updated.enabled = old.enabled;
        item.info = updated.clone();
        item.task = new_task;
        let model = port_forward::ActiveModel::from(port_forward::Model {
            id: updated.id.clone(),
            target_id: updated.target_id,
            local_host: updated.local_host.clone(),
            local_port: updated.local_port,
            remote_host: updated.remote_host.clone(),
            remote_port: updated.remote_port,
            enabled: updated.enabled,
        });
        map_db_err!(model.update(&self.db).await)?;
        info!("forward_id={} forwarding configuration updated", updated.id);
        Ok(updated)
    }

    pub async fn remove(&self, id: &str) -> Result<bool, ApiErr> {
        if !self.tasks.lock().await.contains_key(id) {
            return Ok(false);
        }
        map_db_err!(port_forward::Entity::delete_by_id(id).exec(&self.db).await)?;
        let item = self.tasks.lock().await.remove(id);
        if let Some(item) = item {
            if let Some(task) = item.task {
                task.abort();
            }
            info!("forward_id={} forwarding removed", id);
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

pub(crate) fn router_builder(manager: Arc<PortForwardManager>) -> axum::Router {
    use axum::{Router, routing::get};
    Router::new()
        .route("/list", get(handlers::list))
        .route("/create", axum::routing::post(handlers::create))
        .route("/update", axum::routing::post(handlers::update))
        .route("/toggle", axum::routing::post(handlers::toggle))
        .route("/remove", axum::routing::post(handlers::remove))
        .with_state(manager)
}
