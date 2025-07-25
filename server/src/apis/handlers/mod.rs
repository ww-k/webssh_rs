pub mod sftp;
pub mod ssh;

use serde::Deserialize;

#[derive(Deserialize, Debug)]
pub struct QueryTargetId {
    target_id: i32,
}
