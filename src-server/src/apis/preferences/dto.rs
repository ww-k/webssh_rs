use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

#[derive(Debug, Deserialize, Serialize, Clone, ToSchema)]
pub struct Preferences {
    pub active_tab_key: String,
    pub tabs: Vec<PreferenceTab>,
}

#[derive(Debug, Deserialize, Serialize, Clone, ToSchema)]
pub struct PreferenceTab {
    pub key: String,
    pub label: String,
    pub path: String,
    #[schema(value_type = Object)]
    pub state: Option<Value>,
}
