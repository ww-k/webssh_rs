pub mod sftp;
pub mod ssh;
pub mod ssh_connection;

use serde::Deserialize;

#[derive(Deserialize, Debug)]
pub struct QueryTargetId {
    target_id: i32,
}
