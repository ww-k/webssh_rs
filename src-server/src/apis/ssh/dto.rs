use serde::Deserialize;

#[derive(Deserialize, Debug, utoipa::IntoParams)]
pub struct QueryTargetId {
    pub target_id: i32,
}

#[derive(Deserialize, Debug)]
pub(crate) struct TerminalQueryParams {
    pub(crate) target_id: i32,
}

#[derive(Deserialize, Debug)]
#[allow(dead_code)]
pub(crate) struct Resize {
    pub(crate) col: u32,
    pub(crate) row: u32,
}
