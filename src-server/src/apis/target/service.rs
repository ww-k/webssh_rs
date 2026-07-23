use sea_orm::DatabaseConnection;

use crate::{
    apis::{ApiErr, target::dto::TargetUpdatePayload},
    consts::services_err_code::*,
    entities::target,
    map_db_err,
    repositories::target as target_repository,
    target_ssh_service::TargetSshService,
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
    ssh_service: &TargetSshService,
    payload: TargetUpdatePayload,
) -> Result<target::Model, ApiErr> {
    let active_model = target::ActiveModel::from(payload);
    let target = map_db_err!(ssh_service.update_target(active_model).await)?;
    Ok(target)
}

pub async fn remove(ssh_service: &TargetSshService, id: i32) -> Result<(), ApiErr> {
    map_db_err!(ssh_service.remove_target(id).await)?;
    Ok(())
}
