use anyhow::Result;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CheckServerKey {
    /// Accept unknown host keys and remember them, but reject changed keys.
    AcceptNew,
    /// Only accept host keys that already exist in ssh_known_host.
    Strict,
    /// Skip host key checking and do not write observed keys.
    Disabled,
}

impl CheckServerKey {
    pub fn from_env_value(value: &str) -> Option<Self> {
        match value.trim().to_lowercase().as_str() {
            "accept-new" | "accept_new" | "acceptnew" => Some(Self::AcceptNew),
            "strict" => Some(Self::Strict),
            "disabled" | "disable" | "off" | "false" | "no" => Some(Self::Disabled),
            _ => None,
        }
    }
}

pub struct Config {
    pub max_session_per_target: u8,
    pub max_channel_per_session: u8,
    pub check_server_key: CheckServerKey,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            max_session_per_target: 10,
            max_channel_per_session: 10,
            check_server_key: CheckServerKey::AcceptNew,
        }
    }
}

impl Config {
    pub async fn load_config() -> Result<Self> {
        let mut config = Config::default();
        if let Ok(value) = std::env::var("WEBSSH_RS_CHECK_SERVER_KEY") {
            config.check_server_key =
                CheckServerKey::from_env_value(value.as_str()).ok_or_else(|| {
                    anyhow::anyhow!(
                        "invalid WEBSSH_RS_CHECK_SERVER_KEY value: {value}; expected accept-new, strict, or disabled"
                    )
                })?;
        }

        Ok(config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_check_server_key_env_value() {
        assert_eq!(
            CheckServerKey::from_env_value("accept-new"),
            Some(CheckServerKey::AcceptNew)
        );
        assert_eq!(
            CheckServerKey::from_env_value("STRICT"),
            Some(CheckServerKey::Strict)
        );
        assert_eq!(
            CheckServerKey::from_env_value("off"),
            Some(CheckServerKey::Disabled)
        );
        assert_eq!(CheckServerKey::from_env_value("unknown"), None);
    }
}
