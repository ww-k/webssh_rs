use std::sync::Arc;

use axum::{
    Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    AppState, apis::ssh, entities::target::Model as TargetModel,
    repositories::target as target_repository, ssh_connection_pool::ChannelMode,
};

const PROTOCOL_VERSION: &str = "2024-11-05";

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    #[serde(default)]
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Deserialize)]
struct ToolCallParams {
    name: String,
    #[serde(default)]
    arguments: Value,
}

#[derive(Debug, Deserialize)]
struct ExecuteCommandArguments {
    target_id: i32,
    command: String,
}

#[derive(Debug, Serialize)]
struct PublicTarget {
    id: i32,
    name: String,
    directory: String,
    host: String,
    port: Option<u16>,
    user: String,
    system: Option<String>,
    jump_host_id: Option<i32>,
}

impl From<TargetModel> for PublicTarget {
    fn from(target: TargetModel) -> Self {
        Self {
            id: target.id,
            name: target.name,
            directory: target.directory,
            host: target.host,
            port: target.port,
            user: target.user,
            system: target.system,
            jump_host_id: target.jump_host_id,
        }
    }
}

pub(crate) fn router_builder(app_state: Arc<AppState>) -> Router {
    Router::new().route("/", post(handle)).with_state(app_state)
}

async fn handle(
    State(state): State<Arc<AppState>>,
    request: axum::Json<JsonRpcRequest>,
) -> Response {
    let request = request.0;
    if request.jsonrpc != "2.0" {
        return json_rpc_error(request.id, -32600, "Invalid Request");
    }

    if request.method == "notifications/initialized" {
        return StatusCode::ACCEPTED.into_response();
    }

    let Some(id) = request.id else {
        return StatusCode::ACCEPTED.into_response();
    };

    match request.method.as_str() {
        "initialize" => json_rpc_result(
            id,
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": {
                    "name": "webssh-rs",
                    "version": env!("CARGO_PKG_VERSION"),
                },
            }),
        ),
        "ping" => json_rpc_result(id, json!({})),
        "tools/list" => json_rpc_result(id, json!({ "tools": tool_definitions() })),
        "tools/call" => match serde_json::from_value::<ToolCallParams>(request.params) {
            Ok(params) => call_tool(id, state, params).await,
            Err(error) => json_rpc_error(
                Some(id),
                -32602,
                &format!("Invalid tools/call parameters: {error}"),
            ),
        },
        _ => json_rpc_error(Some(id), -32601, "Method not found"),
    }
}

fn tool_definitions() -> Value {
    json!([
        {
            "name": "list_targets",
            "description": "列出可用的 SSH 目标。返回目标 ID、名称和连接信息，不包含密码或私钥。",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        },
        {
            "name": "execute_command",
            "description": "在指定的 SSH 目标上执行命令并返回标准输出。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "target_id": {
                        "type": "integer",
                        "description": "目标 ID，可通过 list_targets 获取"
                    },
                    "command": {
                        "type": "string",
                        "description": "要执行的 shell 命令"
                    }
                },
                "required": ["target_id", "command"],
                "additionalProperties": false
            }
        }
    ])
}

async fn call_tool(id: Value, state: Arc<AppState>, params: ToolCallParams) -> Response {
    match params.name.as_str() {
        "list_targets" => {
            let result = target_repository::list(&state.db).await;
            match result {
                Ok(targets) => tool_result(
                    id,
                    serde_json::to_value(
                        targets
                            .into_iter()
                            .map(PublicTarget::from)
                            .collect::<Vec<_>>(),
                    )
                    .expect("public targets are serializable"),
                ),
                Err(error) => tool_error(id, format!("failed to list targets: {error}")),
            }
        }
        "execute_command" => {
            let arguments =
                match serde_json::from_value::<ExecuteCommandArguments>(params.arguments) {
                    Ok(arguments) => arguments,
                    Err(error) => {
                        return tool_error(
                            id,
                            format!("invalid execute_command arguments: {error}"),
                        );
                    }
                };
            let channel = match state
                .connection_pool
                .channel(arguments.target_id, ChannelMode::Shared)
                .await
            {
                Ok(channel) => channel,
                Err(error) => return tool_error(id, error.to_string()),
            };
            match ssh::exec(channel, &arguments.command).await {
                Ok(output) => tool_result(id, json!(output)),
                Err(error) => tool_error(id, error.message),
            }
        }
        _ => tool_error(id, format!("unknown tool: {}", params.name)),
    }
}

fn tool_result(id: Value, value: Value) -> Response {
    json_rpc_result(
        id,
        json!({
            "content": [{ "type": "text", "text": tool_text(&value) }],
        }),
    )
}

fn tool_error(id: Value, message: String) -> Response {
    json_rpc_result(
        id,
        json!({
            "isError": true,
            "content": [{ "type": "text", "text": message }],
        }),
    )
}

fn tool_text(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        value => serde_json::to_string_pretty(&value).expect("JSON values are serializable"),
    }
}

fn json_rpc_result(id: Value, result: Value) -> Response {
    (
        StatusCode::OK,
        axum::Json(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
        })),
    )
        .into_response()
}

fn json_rpc_error(id: Option<Value>, code: i32, message: &str) -> Response {
    (
        StatusCode::OK,
        axum::Json(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message },
        })),
    )
        .into_response()
}
