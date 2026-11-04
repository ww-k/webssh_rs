use std::{
    collections::{HashMap, HashSet},
    num::NonZeroU32,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use ring::{
    aead, pbkdf2,
    rand::{SecureRandom, SystemRandom},
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
            EncryptedUserDataExport, USER_DATA_VERSION, UserDataDocument, UserDataExportPayload,
            UserDataFavoriteDirectory, UserDataImportPayload, UserDataImportResult,
            UserDataImportUrlPayload, UserDataTarget,
        },
    },
    consts::services_err_code::{
        ERR_CODE_DB_ERR, ERR_CODE_JSON_ERR, ERR_CODE_USER_DATA_DECRYPT_FAILED,
        ERR_CODE_USER_DATA_PASSWORD_REQUIRED, ERR_CODE_USER_DATA_URL_FETCH_FAILED,
        ERR_CODE_USER_DATA_URL_FORMAT, ERR_CODE_USER_DATA_URL_INVALID,
    },
    entities::{favorite_directory, target},
    map_db_err,
};

pub async fn export(
    db: &DatabaseConnection,
    payload: UserDataExportPayload,
) -> Result<serde_json::Value, ApiErr> {
    let targets = map_db_err!(target::Entity::find().all(db).await)?;
    let favorites = map_db_err!(
        favorite_directory::Entity::find()
            .filter(favorite_directory::Column::IsDefault.eq(false))
            .all(db)
            .await
    )?;

    let document = UserDataDocument {
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
        settings: payload.settings,
    };
    if let Some(password) = payload.password.filter(|value| !value.is_empty()) {
        Ok(
            serde_json::to_value(encrypt_document(&document, &password)?)
                .map_err(|_| crypto_error())?,
        )
    } else {
        serde_json::to_value(document).map_err(|_| crypto_error())
    }
}

pub async fn import(
    db: &DatabaseConnection,
    payload: UserDataImportPayload,
) -> Result<UserDataImportResult, ApiErr> {
    import_document(db, payload.data, payload.password.as_deref()).await
}

pub async fn import_from_url(
    db: &DatabaseConnection,
    payload: UserDataImportUrlPayload,
) -> Result<UserDataImportResult, ApiErr> {
    let url = reqwest::Url::parse(&payload.url).map_err(|_| url_error())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(url_error());
    }
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|err| fetch_error(err.to_string()))?
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|err| fetch_error(err.to_string()))?
        .error_for_status()
        .map_err(|err| fetch_error(err.to_string()))?;
    let body = response
        .bytes()
        .await
        .map_err(|err| fetch_error(err.to_string()))?;
    if body.len() > 10 * 1024 * 1024 {
        return Err(fetch_error("user data response is too large"));
    }
    let data = serde_json::from_slice(body.as_ref()).map_err(|_| url_format_error())?;
    import_document(db, data, payload.password.as_deref()).await
}

async fn import_document(
    db: &DatabaseConnection,
    data: serde_json::Value,
    password: Option<&str>,
) -> Result<UserDataImportResult, ApiErr> {
    let document = decode_document(data, password)?;
    let import_payload = UserDataImportPayloadData {
        version: document.version,
        targets: document.targets,
        favorite_directories: document.favorite_directories,
    };
    validate_payload(&import_payload)?;
    let transaction = map_db_err!(db.begin().await)?;
    let result = import_in_transaction(&transaction, import_payload).await;
    match result {
        Ok(result) => {
            map_db_err!(transaction.commit().await)?;
            Ok(UserDataImportResult {
                settings: document.settings,
                ..result
            })
        }
        Err(err) => {
            let _ = transaction.rollback().await;
            Err(err)
        }
    }
}

async fn import_in_transaction<C: ConnectionTrait>(
    db: &C,
    payload: UserDataImportPayloadData,
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
            directory: Set(source.directory.clone()),
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
        settings: serde_json::Value::Null,
    })
}

struct UserDataImportPayloadData {
    version: u32,
    targets: Vec<UserDataTarget>,
    favorite_directories: Vec<UserDataFavoriteDirectory>,
}

fn validate_payload(payload: &UserDataImportPayloadData) -> Result<(), ApiErr> {
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

const PBKDF2_ITERATIONS: u32 = 600_000;
const ALGORITHM: &str = "AES-256-GCM-PBKDF2-SHA256";

fn decode_document(
    data: serde_json::Value,
    password: Option<&str>,
) -> Result<UserDataDocument, ApiErr> {
    let is_encrypted = data
        .get("algorithm")
        .and_then(serde_json::Value::as_str)
        .is_some();
    if is_encrypted {
        let envelope: EncryptedUserDataExport =
            serde_json::from_value(data).map_err(|_| crypto_error())?;
        let password = password
            .filter(|value| !value.is_empty())
            .ok_or_else(password_required_error)?;
        decrypt_document(&envelope, password)
    } else {
        serde_json::from_value(data).map_err(|_| ApiErr {
            code: ERR_CODE_JSON_ERR,
            message: "invalid user data".to_string(),
        })
    }
}

fn derive_key(password: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        NonZeroU32::new(PBKDF2_ITERATIONS).unwrap(),
        salt,
        password.as_bytes(),
        &mut key,
    );
    key
}

fn encrypt_document(
    document: &UserDataDocument,
    password: &str,
) -> Result<EncryptedUserDataExport, ApiErr> {
    let rng = SystemRandom::new();
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 12];
    rng.fill(&mut salt).map_err(|_| crypto_error())?;
    rng.fill(&mut nonce).map_err(|_| crypto_error())?;
    let key = derive_key(password, &salt);
    let unbound = aead::UnboundKey::new(&aead::AES_256_GCM, &key).map_err(|_| crypto_error())?;
    let key = aead::LessSafeKey::new(unbound);
    let mut plaintext = serde_json::to_vec(document).map_err(|_| crypto_error())?;
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce),
        aead::Aad::from(ALGORITHM.as_bytes()),
        &mut plaintext,
    )
    .map_err(|_| crypto_error())?;
    Ok(EncryptedUserDataExport {
        version: USER_DATA_VERSION,
        algorithm: ALGORITHM.to_string(),
        salt: BASE64.encode(salt),
        nonce: BASE64.encode(nonce),
        ciphertext: BASE64.encode(plaintext),
    })
}

fn decrypt_document(
    envelope: &EncryptedUserDataExport,
    password: &str,
) -> Result<UserDataDocument, ApiErr> {
    if envelope.version != USER_DATA_VERSION || envelope.algorithm != ALGORITHM {
        return Err(crypto_error());
    }
    let salt = BASE64.decode(&envelope.salt).map_err(|_| crypto_error())?;
    if salt.len() != 16 {
        return Err(crypto_error());
    }
    let nonce_bytes = BASE64.decode(&envelope.nonce).map_err(|_| crypto_error())?;
    let mut nonce = [0u8; 12];
    if nonce_bytes.len() != nonce.len() {
        return Err(crypto_error());
    }
    nonce.copy_from_slice(nonce_bytes.as_slice());
    let mut ciphertext = BASE64
        .decode(&envelope.ciphertext)
        .map_err(|_| crypto_error())?;
    let key_bytes = derive_key(password, &salt);
    let unbound =
        aead::UnboundKey::new(&aead::AES_256_GCM, &key_bytes).map_err(|_| crypto_error())?;
    let key = aead::LessSafeKey::new(unbound);
    let plaintext = key
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(ALGORITHM.as_bytes()),
            &mut ciphertext,
        )
        .map_err(|_| crypto_error())?;
    serde_json::from_slice(plaintext).map_err(|_| crypto_error())
}

fn crypto_error() -> ApiErr {
    ApiErr {
        code: ERR_CODE_USER_DATA_DECRYPT_FAILED,
        message: "invalid password or encrypted user data".to_string(),
    }
}

fn password_required_error() -> ApiErr {
    ApiErr {
        code: ERR_CODE_USER_DATA_PASSWORD_REQUIRED,
        message: "password is required for encrypted user data".to_string(),
    }
}

fn url_error() -> ApiErr {
    ApiErr {
        code: ERR_CODE_USER_DATA_URL_INVALID,
        message: "user data URL must use HTTP or HTTPS".to_string(),
    }
}

fn fetch_error(message: impl Into<String>) -> ApiErr {
    ApiErr {
        code: ERR_CODE_USER_DATA_URL_FETCH_FAILED,
        message: format!("failed to fetch user data: {}", message.into()),
    }
}

fn url_format_error() -> ApiErr {
    ApiErr {
        code: ERR_CODE_USER_DATA_URL_FORMAT,
        message: "user data URL returned invalid JSON".to_string(),
    }
}

impl From<target::Model> for UserDataTarget {
    fn from(target: target::Model) -> Self {
        Self {
            id: target.id,
            name: target.name,
            directory: target.directory,
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
