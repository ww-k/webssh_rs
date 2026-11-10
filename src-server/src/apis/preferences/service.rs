use std::collections::HashMap;

use crate::{
    apis::{
        ApiErr,
        preferences::dto::{PreferenceSettings, PreferenceTab, Preferences},
    },
    consts::services_err_code::ERR_CODE_DB_ERR,
    entities::tab,
    map_db_err,
    repositories::{preference as app_state_repository, tab as tab_repository},
};
use sea_orm::DatabaseConnection;

const ACTIVE_TAB_KEY: &str = "active_tab_key";
const SETTINGS_PREFIX: &str = "settings.";

pub async fn get(db: &DatabaseConnection) -> Result<Option<Preferences>, ApiErr> {
    let values = app_state_repository::map(map_db_err!(app_state_repository::list(db).await)?);
    let tabs = map_db_err!(tab_repository::list(db).await)?;
    if !values.contains_key(ACTIVE_TAB_KEY) && tabs.is_empty() {
        return Ok(None);
    }
    let active_tab_key = values
        .get(ACTIVE_TAB_KEY)
        .cloned()
        .unwrap_or_else(|| tabs.first().map(|tab| tab.key.clone()).unwrap_or_default());
    let settings = settings_from_values(&values)?;
    let tabs = tabs.into_iter().filter_map(tab_to_dto).collect();
    Ok(Some(Preferences {
        active_tab_key,
        tabs,
        settings,
    }))
}

pub async fn save(db: &DatabaseConnection, preferences: Preferences) -> Result<(), ApiErr> {
    let mut values = HashMap::new();
    values.insert(ACTIVE_TAB_KEY.to_string(), preferences.active_tab_key);
    let settings = serde_json::to_value(preferences.settings).map_err(json_error)?;
    if let Some(settings) = settings.as_object() {
        for (key, value) in settings {
            values.insert(format!("{SETTINGS_PREFIX}{key}"), value.to_string());
        }
    }
    let tabs = preferences
        .tabs
        .into_iter()
        .enumerate()
        .map(|(position, tab)| tab_repository::from_preference_with_layout(tab, position as i32))
        .collect();
    map_db_err!(app_state_repository::replace(db, values).await)?;
    map_db_err!(tab_repository::replace(db, tabs).await)
}

fn settings_from_values(values: &HashMap<String, String>) -> Result<PreferenceSettings, ApiErr> {
    let mut settings = PreferenceSettings::default();
    let setting = |key: &str| values.get(&format!("{SETTINGS_PREFIX}{key}"));
    if let Some(value) = setting("theme_mode").and_then(parse_string) {
        settings.theme_mode = value;
    }
    if let Some(value) = setting("sidebar_collapsed").and_then(parse_bool) {
        settings.sidebar_collapsed = value;
    }
    if let Some(value) = setting("show_terminal_copy_notification").and_then(parse_bool) {
        settings.show_terminal_copy_notification = value;
    }
    if let Some(value) = setting("terminal_selection_copy_enabled").and_then(parse_bool) {
        settings.terminal_selection_copy_enabled = value;
    }
    if let Some(value) = setting("terminal_right_click_paste_enabled").and_then(parse_bool) {
        settings.terminal_right_click_paste_enabled = value;
    }
    if let Some(value) = setting("terminal_middle_click_paste_enabled").and_then(parse_bool) {
        settings.terminal_middle_click_paste_enabled = value;
    }
    if let Some(value) = setting("target_double_click_action").and_then(parse_string) {
        settings.target_double_click_action = value;
    }
    if let Some(value) =
        setting("terminal_themes").and_then(|value| serde_json::from_str(value).ok())
    {
        settings.terminal_themes = value;
    }
    if let Some(value) = setting("language").and_then(parse_string) {
        settings.language = value;
    }
    if let Some(value) =
        setting("last_local_directory").and_then(|value| serde_json::from_str(value).ok())
    {
        settings.last_local_directory = value;
    }
    Ok(settings)
}

fn parse_string(value: &String) -> Option<String> {
    serde_json::from_str(value)
        .ok()
        .or_else(|| Some(value.clone()))
}
fn parse_bool(value: &String) -> Option<bool> {
    serde_json::from_str(value).ok()
}

fn tab_to_dto(model: tab::Model) -> Option<PreferenceTab> {
    Some(PreferenceTab {
        key: model.key,
        label: model.label,
        path: model.path,
        state: model
            .state
            .and_then(|value| serde_json::from_str(&value).ok()),
        parent_key: model.parent_key,
        split_direction: model.split_direction,
        split_ratio: model.split_ratio,
        position: Some(model.position),
    })
}

fn json_error(err: serde_json::Error) -> ApiErr {
    ApiErr {
        code: ERR_CODE_DB_ERR,
        message: err.to_string(),
    }
}
