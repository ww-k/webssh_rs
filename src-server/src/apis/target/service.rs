use sea_orm::DatabaseConnection;

use crate::{
    apis::{ApiErr, target::dto::TargetUpdatePayload},
    consts::services_err_code::*,
    entities::target,
    map_db_err,
    repositories::target as target_repository,
    ssh_connection_pool::SshConnectionPool,
};

pub async fn list(db: &DatabaseConnection) -> Result<Vec<target::Model>, ApiErr> {
    let targets = map_db_err!(target_repository::list(db).await)?;
    Ok(targets)
}

pub async fn add(db: &DatabaseConnection, payload: target::Model) -> Result<target::Model, ApiErr> {
    let target = map_db_err!(target_repository::insert(db, payload).await)?;
    Ok(target)
}

pub async fn update(
    db: &DatabaseConnection,
    connection_pool: &SshConnectionPool,
    payload: TargetUpdatePayload,
) -> Result<target::Model, ApiErr> {
    let target_id = payload.id;
    let active_model = target::ActiveModel::from(payload);
    let target = map_db_err!(
        connection_pool
            .with_target_mutation(target_id, move || {
                target_repository::update(db, active_model)
            })
            .await
    )?;
    Ok(target)
}

pub async fn remove(
    db: &DatabaseConnection,
    connection_pool: &SshConnectionPool,
    id: i32,
) -> Result<(), ApiErr> {
    map_db_err!(
        connection_pool
            .with_target_mutation(id, || target_repository::delete_by_id(db, id))
            .await
    )?;
    Ok(())
}
