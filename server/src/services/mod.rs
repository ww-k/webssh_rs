pub mod target;
pub mod ssh;

use axum::{
    extract::{rejection::JsonRejection, FromRequest}, http::StatusCode,
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
            code: ERR_CODE_JSON_NERR,
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
