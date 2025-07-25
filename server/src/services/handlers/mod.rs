use serde::Deserialize;

pub mod sftp;
pub mod ssh_exec;
pub mod ssh_terminal;

#[derive(Deserialize, Debug)]
pub struct QueryTargetId {
    target_id: i32,
}
