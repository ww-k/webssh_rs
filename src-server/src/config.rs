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
    pub transfer_task_concurrency: usize,
    pub transfer_chunk_size: usize,
    pub check_server_key: CheckServerKey,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            max_session_per_target: 10,
            max_channel_per_session: 10,
            transfer_task_concurrency: 3,
            transfer_chunk_size: 10 * 1024 * 1024,
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
        if let Ok(value) = std::env::var("WEBSSH_RS_TRANSFER_TASK_CONCURRENCY") {
            config.transfer_task_concurrency =
                Config::parse_transfer_task_concurrency(value.as_str())?;
        }
        if let Ok(value) = std::env::var("WEBSSH_RS_TRANSFER_CHUNK_SIZE") {
            config.transfer_chunk_size = Config::parse_transfer_chunk_size(value.as_str())?;
        }

        Ok(config)
    }

    fn parse_transfer_task_concurrency(value: &str) -> Result<usize> {
        let concurrency = value.parse::<usize>().map_err(|err| {
            anyhow::anyhow!("invalid WEBSSH_RS_TRANSFER_TASK_CONCURRENCY value: {value}: {err}")
        })?;
        if concurrency == 0 {
            return Err(anyhow::anyhow!(
                "invalid WEBSSH_RS_TRANSFER_TASK_CONCURRENCY value: {value}; expected positive integer"
            ));
        }
        Ok(concurrency)
    }

    fn parse_transfer_chunk_size(value: &str) -> Result<usize> {
        let chunk_size = value.parse::<usize>().map_err(|err| {
            anyhow::anyhow!("invalid WEBSSH_RS_TRANSFER_CHUNK_SIZE value: {value}: {err}")
        })?;
        if chunk_size == 0 {
            return Err(anyhow::anyhow!(
                "invalid WEBSSH_RS_TRANSFER_CHUNK_SIZE value: {value}; expected positive integer"
            ));
        }
        Ok(chunk_size)
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

    #[test]
    fn parse_transfer_task_concurrency() {
        assert_eq!(Config::parse_transfer_task_concurrency("1").unwrap(), 1);
        assert_eq!(Config::parse_transfer_task_concurrency("8").unwrap(), 8);
        assert!(Config::parse_transfer_task_concurrency("0").is_err());
        assert!(Config::parse_transfer_task_concurrency("abc").is_err());
    }

    #[test]
    fn parse_transfer_chunk_size() {
        assert_eq!(Config::parse_transfer_chunk_size("1").unwrap(), 1);
        assert_eq!(
            Config::parse_transfer_chunk_size("10485760").unwrap(),
            10 * 1024 * 1024
        );
        assert!(Config::parse_transfer_chunk_size("0").is_err());
        assert!(Config::parse_transfer_chunk_size("abc").is_err());
    }
}
