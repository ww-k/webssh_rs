use serde::Deserialize;

pub mod ssh_exec;
pub mod ssh_terminal;

#[derive(Deserialize, Debug)]
pub struct QueryTargetId {
    target_id: i32,
    // Add other query parameters here as needed
}
