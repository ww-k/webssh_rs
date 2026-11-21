use std::collections::{HashMap, HashSet};

use crate::{
    apis::{
        ApiErr,
        preferences::dto::{PreferenceSettings, PreferenceTab, Preferences, StoredTab},
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
    let stored_active_tab_key = values
        .get(ACTIVE_TAB_KEY)
        .cloned()
        .unwrap_or_else(|| tabs.first().map(|tab| tab.key.clone()).unwrap_or_default());
    let settings = settings_from_values(&values)?;
    let roots = root_models(&tabs);
    let active_tab_key = find_root_key(&tabs, &stored_active_tab_key);
    let tabs = roots
        .iter()
        .filter_map(|model| {
            let mut layout = layout_node(model, &tabs, &mut HashSet::new())?;
            let active_child_key = model
                .active_child_key
                .as_deref()
                .filter(|key| contains_key(&layout, key))
                .map(str::to_string)
                .or_else(|| first_leaf_key_from_layout(&layout))
                .unwrap_or_else(|| model.key.clone());
            layout.active_child_key = Some(active_child_key);
            layout.label = first_label(&layout).unwrap_or_else(|| "New Tab".to_string());
            Some(layout)
        })
        .collect();
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
    let mut stored_tabs = Vec::new();
    for (position, root) in preferences.tabs.iter().enumerate() {
        flatten_layout(
            root,
            None,
            position as i32,
            root.active_child_key.as_deref(),
            &mut stored_tabs,
        );
    }
    let tabs = stored_tabs
        .into_iter()
        .map(tab_repository::from_preference_with_layout)
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

fn root_models(models: &[tab::Model]) -> Vec<&tab::Model> {
    let mut roots: Vec<_> = models
        .iter()
        .filter(|model| model.parent_key.is_none())
        .collect();
    roots.sort_by_key(|model| model.position);
    roots
}

fn find_root_key(models: &[tab::Model], key: &str) -> String {
    let mut current = models.iter().find(|model| model.key == key);
    let mut visited = HashSet::new();
    while let Some(model) = current {
        if !visited.insert(model.key.clone()) {
            break;
        }
        let Some(parent_key) = model.parent_key.as_deref() else {
            return model.key.clone();
        };
        current = models.iter().find(|candidate| candidate.key == parent_key);
    }
    key.to_string()
}

fn layout_node(
    model: &tab::Model,
    models: &[tab::Model],
    visited: &mut HashSet<String>,
) -> Option<PreferenceTab> {
    if !visited.insert(model.key.clone()) {
        return None;
    }
    let mut child_models: Vec<_> = models
        .iter()
        .filter(|child| child.parent_key.as_deref() == Some(model.key.as_str()))
        .collect();
    child_models.sort_by_key(|child| child.position);
    let child1 = child_models
        .first()
        .and_then(|child| layout_node(child, models, visited))
        .map(Box::new);
    let child2 = child_models
        .get(1)
        .and_then(|child| layout_node(child, models, visited))
        .map(Box::new);
    let is_split = model.split_direction.is_some() || child1.is_some() || child2.is_some();
    let label = if is_split {
        child1
            .as_deref()
            .and_then(first_label)
            .or_else(|| child2.as_deref().and_then(first_label))
            .unwrap_or_default()
    } else {
        model.label.clone().unwrap_or_default()
    };
    Some(PreferenceTab {
        key: model.key.clone(),
        label,
        active_child_key: None,
        direction: model
            .split_direction
            .clone()
            .unwrap_or_else(|| "horizontal".to_string()),
        ratio: if is_split {
            let ratio = model.split_ratio.unwrap_or(0.5);
            (if ratio <= 1.0 { ratio * 100.0 } else { ratio }).clamp(15.0, 85.0)
        } else {
            100.0
        },
        child1,
        child2,
        path: if is_split { None } else { model.path.clone() },
        state: if is_split {
            None
        } else {
            model
                .state
                .as_deref()
                .and_then(|value| serde_json::from_str(value).ok())
        },
    })
}

fn contains_key(node: &PreferenceTab, key: &str) -> bool {
    node.key == key
        || node
            .child1
            .as_deref()
            .is_some_and(|child| contains_key(child, key))
        || node
            .child2
            .as_deref()
            .is_some_and(|child| contains_key(child, key))
}

fn first_leaf_key_from_layout(node: &PreferenceTab) -> Option<String> {
    node.child1
        .as_deref()
        .or(node.child2.as_deref())
        .map_or_else(|| Some(node.key.clone()), first_leaf_key_from_layout)
}

fn first_label(node: &PreferenceTab) -> Option<String> {
    Some(node.label.clone())
        .filter(|label| !label.is_empty())
        .or_else(|| node.child1.as_deref().and_then(first_label))
        .or_else(|| node.child2.as_deref().and_then(first_label))
}

fn flatten_layout(
    node: &PreferenceTab,
    parent_key: Option<String>,
    position: i32,
    active_child_key: Option<&str>,
    output: &mut Vec<StoredTab>,
) {
    let is_leaf = node.child1.is_none() && node.child2.is_none();
    output.push(StoredTab {
        key: node.key.clone(),
        label: if is_leaf {
            Some(node.label.clone())
        } else {
            None
        },
        path: if is_leaf { node.path.clone() } else { None },
        state: if is_leaf { node.state.clone() } else { None },
        parent_key: parent_key.clone(),
        split_direction: if is_leaf {
            None
        } else {
            Some(node.direction.clone())
        },
        split_ratio: if is_leaf {
            None
        } else {
            Some((node.ratio / 100.0).clamp(0.15, 0.85))
        },
        position,
        active_child_key: active_child_key.map(str::to_string),
    });
    if let Some(child) = node.child1.as_deref() {
        flatten_layout(child, Some(node.key.clone()), 0, None, output);
    }
    if let Some(child) = node.child2.as_deref() {
        flatten_layout(child, Some(node.key.clone()), 1, None, output);
    }
}

fn json_error(err: serde_json::Error) -> ApiErr {
    ApiErr {
        code: ERR_CODE_DB_ERR,
        message: err.to_string(),
    }
}
