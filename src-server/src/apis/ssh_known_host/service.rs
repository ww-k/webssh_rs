use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder};

use crate::{
    apis::ApiErr, consts::services_err_code::ERR_CODE_DB_ERR, entities::ssh_known_host, map_db_err,
};

pub async fn list(db: &DatabaseConnection) -> Result<Vec<ssh_known_host::Model>, ApiErr> {
    Ok(map_db_err!(
        ssh_known_host::Entity::find()
            .order_by_asc(ssh_known_host::Column::Host)
            .order_by_asc(ssh_known_host::Column::Port)
            .order_by_asc(ssh_known_host::Column::Id)
            .all(db)
            .await
    )?)
}

pub async fn remove(db: &DatabaseConnection, id: i32) -> Result<(), ApiErr> {
    map_db_err!(
        ssh_known_host::Entity::delete_many()
            .filter(ssh_known_host::Column::Id.eq(id))
            .exec(db)
            .await
    )?;
    Ok(())
}
