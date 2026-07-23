use std::{error::Error, fmt, time::Duration};

pub type SshPoolResult<T> = Result<T, SshPoolError>;

#[derive(Debug)]
#[non_exhaustive]
pub enum SshPoolError {
    ConnectTimeout {
        timeout: Duration,
    },
    UnsupportedAuthMethod,
    AuthenticationFailed,
    ConnectionExpired {
        connection_id: String,
    },
    CapacityExceeded {
        resource: &'static str,
        limit: usize,
    },
    HostKeyUnknown {
        host: String,
        port: u16,
        fingerprint: String,
    },
    HostKeyMismatch {
        host: String,
        port: u16,
        expected_fingerprints: Vec<String>,
        actual_fingerprint: String,
    },
    Key(russh::keys::Error),
    Ssh(russh::Error),
    Database(sea_orm::DbErr),
}

impl fmt::Display for SshPoolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ConnectTimeout { timeout } => {
                write!(f, "SSH connection timed out after {timeout:?}")
            }
            Self::UnsupportedAuthMethod => f.write_str("unsupported SSH authentication method"),
            Self::AuthenticationFailed => f.write_str("SSH authentication failed"),
            Self::ConnectionExpired { connection_id } => {
                write!(f, "SSH connection {connection_id} is no longer active")
            }
            Self::CapacityExceeded { resource, limit } => {
                write!(f, "maximum {resource} capacity of {limit} reached")
            }
            Self::HostKeyUnknown {
                host,
                port,
                fingerprint,
            } => write!(
                f,
                "SSH host key for {host}:{port} is not trusted ({fingerprint})"
            ),
            Self::HostKeyMismatch {
                host,
                port,
                expected_fingerprints,
                actual_fingerprint,
            } => write!(
                f,
                "SSH host key mismatch for {host}:{port}: expected one of {}, got {actual_fingerprint}",
                expected_fingerprints.join(", ")
            ),
            Self::Key(err) => err.fmt(f),
            Self::Ssh(err) => err.fmt(f),
            Self::Database(err) => err.fmt(f),
        }
    }
}

impl Error for SshPoolError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Ssh(err) => Some(err),
            Self::Key(err) => Some(err),
            Self::Database(err) => Some(err),
            _ => None,
        }
    }
}

impl From<russh::Error> for SshPoolError {
    fn from(err: russh::Error) -> Self {
        Self::Ssh(err)
    }
}

impl From<russh::keys::Error> for SshPoolError {
    fn from(err: russh::keys::Error) -> Self {
        Self::Key(err)
    }
}

impl From<sea_orm::DbErr> for SshPoolError {
    fn from(err: sea_orm::DbErr) -> Self {
        Self::Database(err)
    }
}
