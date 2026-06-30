use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait};

use crate::{
    apis::{ApiErr, target::dto::TargetUpdatePayload},
    consts::services_err_code::*,
    entities::target,
    map_db_err,
};

pub async fn list(db: &DatabaseConnection) -> Result<Vec<target::Model>, ApiErr> {
    let targets = map_db_err!(target::Entity::find().all(db).await)?;
    Ok(targets)
}

pub async fn add(db: &DatabaseConnection, payload: target::Model) -> Result<target::Model, ApiErr> {
    let mut active_model = target::ActiveModel::from(payload);
    active_model.id = sea_orm::ActiveValue::NotSet;

    let target = map_db_err!(active_model.insert(db).await)?;
    Ok(target)
}

pub async fn update(
    db: &DatabaseConnection,
    payload: TargetUpdatePayload,
) -> Result<target::Model, ApiErr> {
    let active_model = target::ActiveModel::from(payload);
    let target = map_db_err!(active_model.update(db).await)?;
    Ok(target)
}

pub async fn remove(db: &DatabaseConnection, id: i32) -> Result<(), ApiErr> {
    map_db_err!(target::Entity::delete_by_id(id).exec(db).await)?;
    Ok(())
}

pub async fn get_target_by_id(
    db: &DatabaseConnection,
    target_id: i32,
) -> anyhow::Result<target::Model> {
    let result = target::Entity::find_by_id(target_id)
        .one(db)
        .await
        .map_err(|db_err| anyhow::format_err!("Failed to get target {:?}", db_err))?;

    if result.is_none() {
        anyhow::bail!("no target found");
    }

    Ok(result.unwrap())
}
