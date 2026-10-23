use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

#[derive(Debug, Deserialize, Serialize, Clone, ToSchema)]
pub struct Preferences {
    pub active_tab_key: String,
    pub tabs: Vec<PreferenceTab>,
    #[serde(default)]
    pub settings: PreferenceSettings,
}

#[derive(Debug, Deserialize, Serialize, Clone, ToSchema)]
pub struct PreferenceSettings {
    pub theme_mode: String,
    pub sidebar_collapsed: bool,
    pub show_terminal_copy_notification: bool,
    #[serde(default = "default_enabled")]
    pub terminal_selection_copy_enabled: bool,
    #[serde(default = "default_enabled")]
    pub terminal_right_click_paste_enabled: bool,
    #[serde(default = "default_enabled")]
    pub terminal_middle_click_paste_enabled: bool,
    pub language: String,
    pub last_local_directory: Option<String>,
}

impl Default for PreferenceSettings {
    fn default() -> Self {
        Self {
            theme_mode: "system".to_string(),
            sidebar_collapsed: true,
            show_terminal_copy_notification: true,
            terminal_selection_copy_enabled: true,
            terminal_right_click_paste_enabled: true,
            terminal_middle_click_paste_enabled: true,
            language: "zh".to_string(),
            last_local_directory: None,
        }
    }
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Deserialize, Serialize, Clone, ToSchema)]
pub struct PreferenceTab {
    pub key: String,
    pub label: String,
    pub path: String,
    #[schema(value_type = Object)]
    pub state: Option<Value>,
}
