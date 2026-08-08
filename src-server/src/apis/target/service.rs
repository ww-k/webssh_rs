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
            .with_target_mutation(id, || {
                target_repository::delete_with_favorite_directories(db, id)
            })
            .await
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::{ActiveValue::NotSet, ActiveValue::Set, Database};
    use sea_orm_migration::MigratorTrait;

    use crate::{
        config::CheckServerKey,
        entities::{favorite_directory, target::TargetAuthMethod},
        migrations::Migrator,
        repositories::favorite_directory as favorite_directory_repository,
    };

    use super::*;

    #[tokio::test]
    async fn remove_cleans_remote_favorites_without_touching_local_favorites() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, None).await.unwrap();
        let target = add(
            &db,
            target::Model {
                id: 0,
                host: "127.0.0.1".to_string(),
                port: Some(22),
                method: TargetAuthMethod::Password,
                user: "test".to_string(),
                key: None,
                password: Some("password".to_string()),
                system: None,
            },
        )
        .await
        .unwrap();
        let local = favorite_directory_repository::insert_if_absent(
            &db,
            0,
            "/local",
            favorite_directory::ActiveModel {
                id: NotSet,
                target_id: Set(0),
                name: Set("Local".to_string()),
                path: Set("/local".to_string()),
                is_default: Set(false),
                created_at: Set(1),
            },
        )
        .await
        .unwrap();
        favorite_directory_repository::initialize_defaults(&db, 0, 1, Vec::new())
            .await
            .unwrap();
        favorite_directory_repository::insert_if_absent(
            &db,
            target.id,
            "/remote",
            favorite_directory::ActiveModel {
                id: NotSet,
                target_id: Set(target.id),
                name: Set("Remote".to_string()),
                path: Set("/remote".to_string()),
                is_default: Set(false),
                created_at: Set(1),
            },
        )
        .await
        .unwrap();
        favorite_directory_repository::initialize_defaults(&db, target.id, 1, Vec::new())
            .await
            .unwrap();
        let connection_pool = SshConnectionPool::new(db.clone(), CheckServerKey::Disabled, 1, 1);

        remove(&db, &connection_pool, target.id).await.unwrap();

        assert!(
            target_repository::find_by_id(&db, target.id)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            favorite_directory_repository::list_by_target(&db, target.id)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            !favorite_directory_repository::is_initialized(&db, target.id)
                .await
                .unwrap()
        );
        assert_eq!(
            favorite_directory_repository::list_by_target(&db, 0)
                .await
                .unwrap(),
            vec![local.clone()]
        );
        assert!(
            favorite_directory_repository::is_initialized(&db, 0)
                .await
                .unwrap()
        );

        remove(&db, &connection_pool, 0).await.unwrap();
        assert_eq!(
            favorite_directory_repository::list_by_target(&db, 0)
                .await
                .unwrap(),
            vec![local]
        );
        assert!(
            favorite_directory_repository::is_initialized(&db, 0)
                .await
                .unwrap()
        );
    }
}
