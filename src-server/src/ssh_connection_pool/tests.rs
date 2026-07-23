use std::{sync::Arc, time::Duration};

use axum::{
    extract::{Query, State},
    http::HeaderMap,
};
use futures_util::StreamExt;
use sea_orm::{ActiveModelTrait, ActiveValue::Set, Database};
use sea_orm_migration::MigratorTrait;

use crate::{
    AppBaseState, AppState,
    apis::{
        sftp::{download, dto::SftpFileUriPayload},
        target::{TargetUpdatePayload, remove_for_test, update_for_test},
        transfer::TransferService,
    },
    config::{CheckServerKey, Config},
    entities::target::{self, TargetAuthMethod},
    migrations::Migrator,
    repositories::target as target_repository,
    target_ssh_service::TargetSshService,
    tests::sftp_server,
};

use super::{ChannelMode, ConnectionState, SshConnectionPool, SshPoolError};

struct TestContext {
    db: sea_orm::DatabaseConnection,
    _disconnect_tx: tokio::sync::broadcast::Sender<String>,
    channel_open_control: sftp_server::ChannelOpenControl,
}

async fn context() -> TestContext {
    let db = Database::connect("sqlite::memory:").await.unwrap();
    Migrator::up(&db, None).await.unwrap();
    target::ActiveModel::from(test_target())
        .insert(&db)
        .await
        .unwrap();
    let (disconnect_tx, channel_open_control) = sftp_server::run_server_with_channel_control()
        .await
        .unwrap();
    TestContext {
        db,
        _disconnect_tx: disconnect_tx,
        channel_open_control,
    }
}

fn test_target() -> target::Model {
    target::Model {
        id: 1,
        host: "127.0.0.1".to_string(),
        port: Some(2222),
        method: TargetAuthMethod::Password,
        user: "root".to_string(),
        key: None,
        password: Some("123456".to_string()),
        system: Some("linux".to_string()),
    }
}

fn service(
    context: &TestContext,
    max_connections: usize,
    max_channels: usize,
) -> (Arc<SshConnectionPool>, TargetSshService) {
    let pool = Arc::new(SshConnectionPool::new(
        context.db.clone(),
        CheckServerKey::AcceptNew,
        max_connections,
        max_channels,
    ));
    let service = TargetSshService::new(context.db.clone(), Arc::clone(&pool));
    (pool, service)
}

#[tokio::test]
async fn connection_pool_regressions() {
    let context = context().await;
    unsupported_auth_is_rejected_before_pool_creation(&context).await;
    tokio::time::timeout(
        Duration::from_secs(10),
        released_channel_capacity_can_be_acquired_again(&context),
    )
    .await
    .expect("capacity release scenario timed out");
    tokio::time::timeout(
        Duration::from_secs(10),
        split_keeps_capacity_until_transfer_guard_is_dropped(&context),
    )
    .await
    .expect("split lease scenario timed out");
    tokio::time::timeout(
        Duration::from_secs(10),
        dedicated_channel_does_not_expire_an_active_shared_connection(&context),
    )
    .await
    .expect("dedicated isolation scenario timed out");
    tokio::time::timeout(
        Duration::from_secs(10),
        changed_connection_spec_replaces_the_target_connection_pool(&context),
    )
    .await
    .expect("connection spec replacement scenario timed out");
    tokio::time::timeout(
        Duration::from_secs(10),
        expiring_an_idle_connection_closes_it(&context),
    )
    .await
    .expect("idle expiry scenario timed out");
    tokio::time::timeout(
        Duration::from_secs(10),
        dropping_dedicated_sftp_releases_its_connection(&context),
    )
    .await
    .expect("dedicated SFTP cleanup scenario timed out");
    tokio::time::timeout(
        Duration::from_secs(10),
        hard_aborting_dedicated_sftp_releases_its_connection(&context),
    )
    .await
    .expect("dedicated SFTP hard-abort scenario timed out");
    tokio::time::timeout(
        Duration::from_secs(10),
        download_body_releases_its_sftp_lease(&context),
    )
    .await
    .expect("download body lifecycle scenario timed out");
    tokio::time::timeout(
        Duration::from_secs(10),
        target_expiry_rejects_a_channel_opened_after_expiry(&context),
    )
    .await
    .expect("post-open target expiry scenario timed out");
    tokio::time::timeout(
        Duration::from_secs(10),
        target_update_is_not_blocked_by_a_capacity_waiter(&context),
    )
    .await
    .expect("target update scenario timed out");
    tokio::time::timeout(
        Duration::from_secs(10),
        target_delete_is_not_blocked_by_a_capacity_waiter(&context),
    )
    .await
    .expect("target delete scenario timed out");
}

async fn unsupported_auth_is_rejected_before_pool_creation(context: &TestContext) {
    let mut unsupported = target::ActiveModel::from(test_target());
    unsupported.method = Set(TargetAuthMethod::None);
    unsupported.update(&context.db).await.unwrap();

    let (pool, service) = service(context, 1, 1);
    let err = match service.channel(1, ChannelMode::Shared).await {
        Ok(_) => panic!("unsupported authentication should be rejected"),
        Err(err) => err,
    };
    assert!(matches!(
        err.downcast_ref::<SshPoolError>(),
        Some(SshPoolError::UnsupportedAuthMethod)
    ));
    assert!(pool.connection_snapshots(Some(1)).await.is_empty());

    let mut restored = target::ActiveModel::from(test_target());
    restored.method = Set(TargetAuthMethod::Password);
    restored.update(&context.db).await.unwrap();
}

async fn released_channel_capacity_can_be_acquired_again(context: &TestContext) {
    let (_pool, service) = service(context, 1, 1);
    let first = service.channel(1, ChannelMode::Shared).await.unwrap();

    assert!(
        tokio::time::timeout(
            Duration::from_millis(100),
            service.channel(1, ChannelMode::Shared),
        )
        .await
        .is_err()
    );

    drop(first);
    let second = tokio::time::timeout(
        Duration::from_secs(2),
        service.channel(1, ChannelMode::Shared),
    )
    .await
    .expect("released permit should wake a waiter")
    .unwrap();
    drop(second);
}

async fn split_keeps_capacity_until_transfer_guard_is_dropped(context: &TestContext) {
    let (_pool, service) = service(context, 1, 1);
    let channel = service.channel(1, ChannelMode::Shared).await.unwrap();
    let (reader, writer, lease) = channel.split().unwrap();
    writer.close().await.unwrap();
    drop(reader);
    drop(writer);

    assert!(
        tokio::time::timeout(
            Duration::from_millis(100),
            service.channel(1, ChannelMode::Shared),
        )
        .await
        .is_err()
    );

    drop(lease);
    let channel = tokio::time::timeout(
        Duration::from_secs(2),
        service.channel(1, ChannelMode::Shared),
    )
    .await
    .expect("dropping split lease should release capacity")
    .unwrap();
    drop(channel);
}

async fn dedicated_channel_does_not_expire_an_active_shared_connection(context: &TestContext) {
    let (pool, service) = service(context, 2, 1);
    let mut shared = service.channel(1, ChannelMode::Shared).await.unwrap();
    let dedicated = service.channel(1, ChannelMode::Dedicated).await.unwrap();

    let snapshots = pool.connection_snapshots(Some(1)).await;
    assert_eq!(snapshots.len(), 2);
    assert_eq!(
        snapshots
            .iter()
            .filter(|snapshot| snapshot.state == ConnectionState::Active)
            .count(),
        1
    );
    assert_eq!(
        snapshots
            .iter()
            .filter(|snapshot| snapshot.state == ConnectionState::Expiring)
            .count(),
        1
    );

    drop(dedicated);
    shared.exec(true, "hello").await.unwrap();
    let message = tokio::time::timeout(Duration::from_secs(2), shared.wait())
        .await
        .unwrap();
    assert!(matches!(message, Some(russh::ChannelMsg::Data { .. })));
    drop(shared);
}

async fn changed_connection_spec_replaces_the_target_connection_pool(context: &TestContext) {
    let (pool, service) = service(context, 1, 1);
    let old_channel = service.channel(1, ChannelMode::Shared).await.unwrap();
    let old_connection_id = pool.connection_snapshots(Some(1)).await[0].id.clone();

    let mut changed = target::ActiveModel::from(test_target());
    changed.password = Set(Some("changed".to_string()));
    changed.update(&context.db).await.unwrap();
    let replacement = tokio::time::timeout(
        Duration::from_secs(2),
        service.channel(1, ChannelMode::Shared),
    )
    .await
    .expect("replacement channel acquisition timed out")
    .unwrap();
    let snapshots = pool.connection_snapshots(Some(1)).await;
    assert_eq!(snapshots.len(), 2);
    assert!(snapshots.iter().any(|snapshot| {
        snapshot.id == old_connection_id && snapshot.state == ConnectionState::Expiring
    }));
    assert!(snapshots.iter().any(|snapshot| {
        snapshot.id != old_connection_id && snapshot.state == ConnectionState::Active
    }));

    drop(old_channel);
    wait_until_connection_is_removed(&pool, &old_connection_id).await;
    drop(replacement);
}

async fn expiring_an_idle_connection_closes_it(context: &TestContext) {
    let (pool, service) = service(context, 1, 1);
    let channel = service.channel(1, ChannelMode::Shared).await.unwrap();
    drop(channel);
    let connection_id = pool.connection_snapshots(Some(1)).await[0].id.clone();

    assert!(pool.expire_connection(1, &connection_id).await);
    wait_until_connection_is_removed(&pool, &connection_id).await;
}

async fn dropping_dedicated_sftp_releases_its_connection(context: &TestContext) {
    let (_pool, service) = service(context, 1, 1);
    let sftp = service.sftp(1, ChannelMode::Dedicated).await.unwrap();
    drop(sftp);

    let shared = tokio::time::timeout(
        Duration::from_secs(2),
        service.channel(1, ChannelMode::Shared),
    )
    .await
    .expect("dropping the SFTP guard should close its dedicated connection")
    .unwrap();
    drop(shared);
}

async fn hard_aborting_dedicated_sftp_releases_its_connection(context: &TestContext) {
    let (pool, service) = service(context, 1, 1);
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let task_service = service.clone();
    let task = tokio::spawn(async move {
        let sftp = task_service.sftp(1, ChannelMode::Dedicated).await.unwrap();
        let _ = ready_tx.send(());
        std::future::pending::<()>().await;
        drop(sftp);
    });
    ready_rx.await.unwrap();
    let snapshots = pool.connection_snapshots(Some(1)).await;
    assert_eq!(snapshots.len(), 1);
    assert_eq!(snapshots[0].state, ConnectionState::Expiring);
    assert_eq!(snapshots[0].active_channels, 1);

    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());

    let shared = tokio::time::timeout(
        Duration::from_secs(2),
        service.channel(1, ChannelMode::Shared),
    )
    .await
    .expect("hard-aborted SFTP task should release its dedicated connection")
    .unwrap();
    drop(shared);
}

async fn download_body_releases_its_sftp_lease(context: &TestContext) {
    let (pool, state) = download_app_state(context);
    let response = download_response(Arc::clone(&state)).await;
    assert_eq!(active_channel_count(&pool).await, 1);

    let mut body = response.into_body().into_data_stream();
    let mut downloaded = Vec::with_capacity(sftp_server::DOWNLOAD_FILE_SIZE);
    while let Some(chunk) = body.next().await {
        downloaded.extend_from_slice(&chunk.unwrap());
    }
    assert_eq!(downloaded.len(), sftp_server::DOWNLOAD_FILE_SIZE);
    assert!(
        downloaded
            .iter()
            .enumerate()
            .all(|(index, byte)| *byte == (index % 251) as u8)
    );
    wait_until_no_active_channels(&pool).await;

    let response = download_response(state).await;
    let mut body = response.into_body().into_data_stream();
    let first_chunk = body.next().await.unwrap().unwrap();
    assert!(!first_chunk.is_empty());
    assert_eq!(active_channel_count(&pool).await, 1);
    drop(body);
    wait_until_no_active_channels(&pool).await;
}

fn download_app_state(context: &TestContext) -> (Arc<SshConnectionPool>, Arc<AppState>) {
    let (pool, service) = service(context, 1, 1);
    let ssh_service = Arc::new(service);
    let base_state = Arc::new(AppBaseState {
        db: context.db.clone(),
        config: Config::default(),
    });
    let transfer_service = TransferService::new(Arc::clone(&base_state), Arc::clone(&ssh_service));
    let state = Arc::new(AppState {
        base_state,
        ssh_service,
        transfer_service,
    });
    (pool, state)
}

async fn download_response(state: Arc<AppState>) -> axum::response::Response {
    download(
        State(state),
        Query(SftpFileUriPayload {
            uri: format!("sftp:1:{}", sftp_server::DOWNLOAD_FILE_PATH),
        }),
        HeaderMap::new(),
    )
    .await
    .unwrap()
}

async fn active_channel_count(pool: &SshConnectionPool) -> usize {
    pool.connection_snapshots(Some(1))
        .await
        .iter()
        .map(|snapshot| snapshot.active_channels)
        .sum()
}

async fn wait_until_no_active_channels(pool: &SshConnectionPool) {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if active_channel_count(pool).await == 0 {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("dropping the download body should release its SFTP lease");
}

async fn target_expiry_rejects_a_channel_opened_after_expiry(context: &TestContext) {
    let (pool, service) = service(context, 1, 1);
    context.channel_open_control.block_next();
    let acquire = tokio::spawn(async move { service.channel(1, ChannelMode::Shared).await });

    context.channel_open_control.wait_until_blocked().await;
    pool.expire_target(1).await;
    context.channel_open_control.release();

    let result = tokio::time::timeout(Duration::from_secs(2), acquire)
        .await
        .expect("channel acquisition should finish after the server accepts it")
        .unwrap();
    let err = match result {
        Ok(channel) => {
            drop(channel);
            panic!("a channel opened after target expiry must not be returned");
        }
        Err(err) => err,
    };
    assert!(matches!(
        err.downcast_ref::<SshPoolError>(),
        Some(SshPoolError::ConnectionExpired { .. })
    ));

    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if pool.connection_snapshots(Some(1)).await.is_empty() {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the rejected channel and expired connection should be cleaned up");
}

async fn target_update_is_not_blocked_by_a_capacity_waiter(context: &TestContext) {
    let (_pool, service) = service(context, 1, 1);
    let active = service.channel(1, ChannelMode::Shared).await.unwrap();
    let waiter = spawn_capacity_waiter(&service).await;

    let current = target_repository::find_by_id(&context.db, 1)
        .await
        .unwrap()
        .unwrap();
    let updated_system = "updated-linux".to_string();
    let payload = TargetUpdatePayload {
        id: current.id,
        host: current.host,
        port: current.port,
        method: current.method,
        user: current.user,
        key: current.key,
        password: current.password,
        system: Some(updated_system.clone()),
    };

    let updated = tokio::time::timeout(Duration::from_secs(2), update_for_test(&service, payload))
        .await
        .expect("target update must not wait for channel capacity")
        .unwrap();
    assert_eq!(updated.system.as_deref(), Some(updated_system.as_str()));
    assert_capacity_waiter_expired(waiter).await;

    let persisted = target_repository::find_by_id(&context.db, 1)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(persisted.system.as_deref(), Some(updated_system.as_str()));
    {
        let refreshed = service.context(1).await.unwrap();
        assert_eq!(
            refreshed.target().system.as_deref(),
            Some(updated_system.as_str())
        );
    }

    drop(active);
}

async fn target_delete_is_not_blocked_by_a_capacity_waiter(context: &TestContext) {
    let (_pool, service) = service(context, 1, 1);
    let active = service.channel(1, ChannelMode::Shared).await.unwrap();
    let waiter = spawn_capacity_waiter(&service).await;

    tokio::time::timeout(Duration::from_secs(2), remove_for_test(&service, 1))
        .await
        .expect("target delete must not wait for channel capacity")
        .unwrap();
    assert_capacity_waiter_expired(waiter).await;

    assert!(
        target_repository::find_by_id(&context.db, 1)
            .await
            .unwrap()
            .is_none()
    );
    assert!(service.context(1).await.is_err());

    drop(active);
}

async fn spawn_capacity_waiter(
    service: &TargetSshService,
) -> tokio::task::JoinHandle<anyhow::Result<super::SshChannelGuard>> {
    let waiting_context = service.context(1).await.unwrap();
    let waiter = tokio::spawn(async move { waiting_context.channel(ChannelMode::Shared).await });
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(
        !waiter.is_finished(),
        "channel acquisition should be waiting for capacity"
    );
    waiter
}

async fn assert_capacity_waiter_expired(
    waiter: tokio::task::JoinHandle<anyhow::Result<super::SshChannelGuard>>,
) {
    let result = tokio::time::timeout(Duration::from_secs(2), waiter)
        .await
        .expect("expired target should wake the capacity waiter")
        .unwrap();
    let err = match result {
        Ok(channel) => {
            drop(channel);
            panic!("expired target must reject the waiting channel acquisition");
        }
        Err(err) => err,
    };
    assert!(matches!(
        err.downcast_ref::<SshPoolError>(),
        Some(SshPoolError::ConnectionExpired { .. })
    ));
}

async fn wait_until_connection_is_removed(pool: &SshConnectionPool, connection_id: &str) {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let snapshots = pool.connection_snapshots(Some(1)).await;
            if snapshots
                .iter()
                .all(|snapshot| snapshot.id != connection_id)
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("closed connection should be removed from the pool");
}
