use std::{
    collections::{HashMap, HashSet},
    time::{SystemTime, UNIX_EPOCH},
};

use sea_orm::{
    ActiveModelTrait,
    ActiveValue::{NotSet, Set},
    ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, QueryFilter, TransactionTrait,
    TryInsertResult,
    sea_query::OnConflict,
};

use crate::{
    apis::{
        ApiErr,
        user_data::dto::{
            USER_DATA_VERSION, UserDataExport, UserDataFavoriteDirectory, UserDataImportPayload,
            UserDataImportResult, UserDataTarget,
        },
    },
    consts::services_err_code::{ERR_CODE_DB_ERR, ERR_CODE_JSON_ERR},
    entities::{favorite_directory, target},
    map_db_err,
};

pub async fn export(db: &DatabaseConnection) -> Result<UserDataExport, ApiErr> {
    let targets = map_db_err!(target::Entity::find().all(db).await)?;
    let favorites = map_db_err!(
        favorite_directory::Entity::find()
            .filter(favorite_directory::Column::IsDefault.eq(false))
            .all(db)
            .await
    )?;

    Ok(UserDataExport {
        version: USER_DATA_VERSION,
        exported_at: now_ms().to_string(),
        targets: targets.into_iter().map(UserDataTarget::from).collect(),
        favorite_directories: favorites
            .into_iter()
            .map(|directory| UserDataFavoriteDirectory {
                target_id: directory.target_id,
                name: directory.name,
                path: directory.path,
            })
            .collect(),
    })
}

pub async fn import(
    db: &DatabaseConnection,
    payload: UserDataImportPayload,
) -> Result<UserDataImportResult, ApiErr> {
    validate_payload(&payload)?;
    let transaction = map_db_err!(db.begin().await)?;
    let result = import_in_transaction(&transaction, payload).await;
    match result {
        Ok(result) => {
            map_db_err!(transaction.commit().await)?;
            Ok(result)
        }
        Err(err) => {
            let _ = transaction.rollback().await;
            Err(err)
        }
    }
}

async fn import_in_transaction<C: ConnectionTrait>(
    db: &C,
    payload: UserDataImportPayload,
) -> Result<UserDataImportResult, ApiErr> {
    let current_targets = map_db_err!(target::Entity::find().all(db).await)?;
    let mut existing_by_key = current_targets
        .iter()
        .map(|target| {
            (
                target_key(
                    target.host.as_str(),
                    target.port,
                    &target.method,
                    target.user.as_str(),
                ),
                target.clone(),
            )
        })
        .collect::<HashMap<_, _>>();
    let mut target_ids = HashMap::new();
    let mut added = Vec::new();
    let mut added_targets = 0;
    let mut skipped_targets = 0;

    for source in payload.targets {
        let key = target_key(&source.host, source.port, &source.method, &source.user);
        if let Some(existing) = existing_by_key.get(&key) {
            target_ids.insert(source.id, existing.id);
            skipped_targets += 1;
            continue;
        }

        let target = target::ActiveModel {
            id: NotSet,
            name: Set(source.name.clone()),
            host: Set(source.host.clone()),
            port: Set(source.port),
            method: Set(source.method.clone()),
            user: Set(source.user.clone()),
            key: Set(source.key.clone()),
            password: Set(source.password.clone()),
            system: Set(source.system.clone()),
            jump_host_id: Set(None),
        };
        let created = map_db_err!(target.insert(db).await)?;
        target_ids.insert(source.id, created.id);
        existing_by_key.insert(key, created.clone());
        added.push((source, created));
        added_targets += 1;
    }

    for (source, mut created) in added {
        let Some(source_jump_host_id) = source.jump_host_id else {
            continue;
        };
        let Some(&jump_host_id) = target_ids.get(&source_jump_host_id) else {
            continue;
        };
        if jump_host_id == created.id {
            continue;
        }
        created.jump_host_id = Some(jump_host_id);
        let active = target::ActiveModel::from(created);
        map_db_err!(active.update(db).await)?;
    }

    let mut existing_favorites = HashMap::<i32, HashSet<String>>::new();
    for target_id in std::iter::once(0).chain(target_ids.values().copied()) {
        let paths = map_db_err!(
            favorite_directory::Entity::find()
                .filter(favorite_directory::Column::TargetId.eq(target_id))
                .all(db)
                .await
        )?
        .into_iter()
        .map(|directory| directory.path)
        .collect();
        existing_favorites.insert(target_id, paths);
    }

    let mut imported_favorites = 0;
    for directory in payload.favorite_directories {
        let target_id = if directory.target_id == 0 {
            Some(0)
        } else {
            target_ids.get(&directory.target_id).copied()
        };
        let Some(target_id) = target_id else {
            continue;
        };
        if directory.name.is_empty() || directory.path.is_empty() {
            continue;
        }
        let paths = existing_favorites.entry(target_id).or_default();
        if paths.contains(&directory.path) {
            continue;
        }

        let active = favorite_directory::ActiveModel {
            id: NotSet,
            target_id: Set(target_id),
            name: Set(directory.name),
            path: Set(directory.path.clone()),
            is_default: Set(false),
            created_at: Set(now_ms()),
        };
        let inserted = map_db_err!(
            favorite_directory::Entity::insert(active)
                .on_conflict(
                    OnConflict::columns([
                        favorite_directory::Column::TargetId,
                        favorite_directory::Column::Path,
                    ])
                    .do_nothing()
                    .to_owned(),
                )
                .do_nothing()
                .exec_without_returning(db)
                .await
        )?;
        if matches!(inserted, TryInsertResult::Inserted(rows) if rows > 0) {
            paths.insert(directory.path);
            imported_favorites += 1;
        }
    }

    Ok(UserDataImportResult {
        added_targets,
        skipped_targets,
        imported_favorites,
    })
}

fn validate_payload(payload: &UserDataImportPayload) -> Result<(), ApiErr> {
    if payload.version != USER_DATA_VERSION {
        return Err(ApiErr {
            code: ERR_CODE_JSON_ERR,
            message: "unsupported user data version".to_string(),
        });
    }
    let mut ids = HashSet::new();
    for target in &payload.targets {
        if target.id <= 0
            || target.host.is_empty()
            || target.user.is_empty()
            || !ids.insert(target.id)
        {
            return Err(ApiErr {
                code: ERR_CODE_JSON_ERR,
                message: "invalid target data".to_string(),
            });
        }
    }
    Ok(())
}

fn target_key(
    host: &str,
    port: Option<u16>,
    method: &target::TargetAuthMethod,
    user: &str,
) -> String {
    format!(
        "{}\0{}\0{}\0{}",
        host.trim().to_lowercase(),
        port.unwrap_or(22),
        method.clone() as i32,
        user.trim()
    )
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

impl From<target::Model> for UserDataTarget {
    fn from(target: target::Model) -> Self {
        Self {
            id: target.id,
            name: target.name,
            host: target.host,
            port: target.port,
            method: target.method,
            user: target.user,
            key: target.key,
            password: target.password,
            system: target.system,
            jump_host_id: target.jump_host_id,
        }
    }
}
