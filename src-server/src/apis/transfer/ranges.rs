use crate::{
    apis::ApiErr,
    consts::services_err_code::{ERR_CODE_TRANSFER_ERR, ERR_CODE_TRANSFER_INVALID_REQUEST},
};

pub type TransferRange = [i64; 2];

pub fn initial_ranges(total: i64) -> Vec<TransferRange> {
    if total <= 0 {
        Vec::new()
    } else {
        vec![[0, total - 1]]
    }
}

pub fn ranges_from_json(ranges: &str) -> Result<Vec<TransferRange>, ApiErr> {
    serde_json::from_str(ranges).map_err(|err| ApiErr {
        code: ERR_CODE_TRANSFER_ERR,
        message: err.to_string(),
    })
}

pub fn ranges_to_json(ranges: &[TransferRange]) -> Result<String, ApiErr> {
    serde_json::to_string(ranges).map_err(|err| ApiErr {
        code: ERR_CODE_TRANSFER_ERR,
        message: err.to_string(),
    })
}

pub fn subtract_range(ranges: Vec<TransferRange>, done_range: TransferRange) -> Vec<TransferRange> {
    let [done_start, done_end] = done_range;
    let mut result = Vec::new();

    for [start, end] in ranges {
        if done_end < start || done_start > end {
            result.push([start, end]);
            continue;
        }

        if done_start > start {
            result.push([start, done_start - 1]);
        }
        if done_end < end {
            result.push([done_end + 1, end]);
        }
    }

    result
}

pub fn ranges_size(ranges: &[TransferRange]) -> i64 {
    ranges.iter().map(|[start, end]| end - start + 1).sum()
}

pub fn invalid_task(message: &str) -> ApiErr {
    ApiErr {
        code: ERR_CODE_TRANSFER_INVALID_REQUEST,
        message: message.to_string(),
    }
}
