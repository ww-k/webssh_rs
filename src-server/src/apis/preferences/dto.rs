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
    #[serde(default)]
    pub terminal_themes: TerminalThemes,
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
            terminal_themes: TerminalThemes::default(),
            language: "zh".to_string(),
            last_local_directory: None,
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Clone, ToSchema)]
pub struct TerminalThemes {
    #[serde(default = "default_terminal_dark_theme")]
    pub dark: TerminalTheme,
    #[serde(default = "default_terminal_light_theme")]
    pub light: TerminalTheme,
}

impl Default for TerminalThemes {
    fn default() -> Self {
        Self {
            dark: default_terminal_dark_theme(),
            light: default_terminal_light_theme(),
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Clone, ToSchema)]
pub struct TerminalTheme {
    pub background: String,
    pub foreground: String,
    pub cursor: String,
    #[serde(alias = "selectionBackground")]
    pub selection_background: String,
    #[serde(alias = "scrollbarThumb")]
    pub scrollbar_thumb: String,
}

fn default_terminal_dark_theme() -> TerminalTheme {
    TerminalTheme {
        background: "#0f1115".to_string(),
        foreground: "#f5f7fa".to_string(),
        cursor: "#f5f7fa".to_string(),
        selection_background: "#3a4352".to_string(),
        scrollbar_thumb: "rgba(255, 255, 255, 0.3)".to_string(),
    }
}

fn default_terminal_light_theme() -> TerminalTheme {
    TerminalTheme {
        background: "#ffffff".to_string(),
        foreground: "#1f2328".to_string(),
        cursor: "#1f2328".to_string(),
        selection_background: "#add6ff".to_string(),
        scrollbar_thumb: "rgba(0, 0, 0, 0.25)".to_string(),
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
