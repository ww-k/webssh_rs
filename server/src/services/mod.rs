pub mod handlers;
pub mod sftp;
pub mod ssh;
pub mod target;

use axum::{
    extract::{FromRequest, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use serde_json::json;

use crate::consts::services_err_code::*;

#[derive(Debug, serde::Serialize)]
pub struct ApiErr {
    pub code: u32,
    pub message: String,
}

impl IntoResponse for ApiErr {
    fn into_response(self) -> Response {
        let body = ValidJson(json!({
            "code": self.code,
            "message": self.message,
        }));
        (StatusCode::INTERNAL_SERVER_ERROR, body).into_response()
    }
}

// We implement `From<JsonRejection> for ApiErr`
impl From<JsonRejection> for ApiErr {
    fn from(rejection: JsonRejection) -> Self {
        Self {
            code: ERR_CODE_JSON_ERR,
            message: rejection.body_text(),
        }
    }
}

// create an extractor that internally uses `axum::Json` but has a custom rejection
#[derive(FromRequest)]
#[from_request(via(axum::Json), rejection(ApiErr))]
pub struct ValidJson<T>(T);

// We implement `IntoResponse` for our extractor so it can be used as a response
impl<T: Serialize> IntoResponse for ValidJson<T> {
    fn into_response(self) -> axum::response::Response {
        let Self(value) = self;
        axum::Json(value).into_response()
    }
}

/// 将错误转换为 code 为 ERR_CODE_SSH_ERR 的 ApiErr
#[macro_export]
macro_rules! map_ssh_err {
    ($expr:expr) => {
        $expr.map_err(|err| ApiErr {
            code: ERR_CODE_SSH_ERR,
            message: err.to_string(),
        })
    };
}

/// 将错误转换为 code 为 ERR_CODE_DB_ERR 的 ApiErr
#[macro_export]
macro_rules! map_db_err {
    ($expr:expr) => {
        $expr.map_err(|err| ApiErr {
            code: ERR_CODE_DB_ERR,
            message: err.to_string(),
        })
    };
}
