use anyhow::{Result, Ok};

pub struct Config {
    pub max_session_per_target: u8,
    pub max_channel_per_session: u8,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            max_session_per_target: 10,
            max_channel_per_session: 10,
        }
    }
}

impl Config {
    pub async fn load_config() -> Result<Self> {
        Ok(Config::default())
    }
}
