use std::{sync::Arc, time::Instant};

use axum::{
    Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tracing::{info, warn};

use crate::{
    AppState,
    apis::{ssh, transfer::CreateUploadTaskPayload},
    entities::{target::Model as TargetModel, transfer_task::Model as TransferTaskModel},
    repositories::target as target_repository,
    ssh_connection_pool::ChannelMode,
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

#[derive(Debug, Deserialize)]
struct UploadFileArguments {
    target_id: i32,
    local_path: String,
    remote_path: String,
}

#[derive(Debug, Deserialize)]
struct GetTransferTaskArguments {
    task_id: String,
}

#[derive(Debug, Default, Deserialize)]
struct ListTargetsArguments {
    #[serde(default)]
    keyword: Option<String>,
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
    let started_at = Instant::now();
    info!(
        target: "webssh_rs_server::mcp",
        method = %request.method,
        request_id = ?request.id,
        "MCP request received"
    );

    if request.jsonrpc != "2.0" {
        warn!(
            target: "webssh_rs_server::mcp",
            method = %request.method,
            request_id = ?request.id,
            elapsed_ms = started_at.elapsed().as_millis() as u64,
            "MCP request rejected: invalid JSON-RPC version"
        );
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
            "description": "列出可用的 SSH 目标，可按关键字匹配名称、目录、用户名或主机。返回目标 ID、名称和连接信息，不包含密码或私钥。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "keyword": {
                        "type": "string",
                        "description": "可选关键字，匹配目标名称、目录、用户名或主机"
                    }
                },
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
        },
        {
            "name": "upload_file",
            "description": "将 MCP 服务端可访问的本地文件上传到指定的 SSH 目标。上传任务会进入持久化传输队列，返回任务 ID 供后续查询。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "target_id": {
                        "type": "integer",
                        "description": "目标 ID，可通过 list_targets 获取"
                    },
                    "local_path": {
                        "type": "string",
                        "description": "MCP 服务端上的本地文件路径"
                    },
                    "remote_path": {
                        "type": "string",
                        "description": "远程目标文件的绝对路径，例如 /tmp/app.tar.gz"
                    }
                },
                "required": ["target_id", "local_path", "remote_path"],
                "additionalProperties": false
            }
        },
        {
            "name": "get_transfer_task",
            "description": "查询文件传输任务的状态和进度。可用 upload_file 返回的 task_id 查询上传是否已经完成。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "传输任务 ID"
                    }
                },
                "required": ["task_id"],
                "additionalProperties": false
            }
        }
    ])
}

async fn call_tool(id: Value, state: Arc<AppState>, params: ToolCallParams) -> Response {
    let tool_name = params.name.clone();
    let started_at = Instant::now();
    info!(
        target: "webssh_rs_server::mcp",
        tool = %tool_name,
        request_id = ?id,
        "MCP tool call started"
    );

    match params.name.as_str() {
        "list_targets" => {
            let arguments = if params.arguments.is_null() {
                ListTargetsArguments::default()
            } else {
                match serde_json::from_value::<ListTargetsArguments>(params.arguments) {
                    Ok(arguments) => arguments,
                    Err(error) => {
                        warn!(
                            target: "webssh_rs_server::mcp",
                            tool = %tool_name,
                            request_id = ?id,
                            elapsed_ms = started_at.elapsed().as_millis() as u64,
                            error = %error,
                            "MCP tool call rejected: invalid arguments"
                        );
                        return tool_error(id, format!("invalid list_targets arguments: {error}"));
                    }
                }
            };
            let result = target_repository::list(&state.db, arguments.keyword.as_deref()).await;
            match result {
                Ok(targets) => {
                    info!(
                        target: "webssh_rs_server::mcp",
                        tool = %tool_name,
                        request_id = ?id,
                        target_count = targets.len(),
                        elapsed_ms = started_at.elapsed().as_millis() as u64,
                        "MCP tool call completed"
                    );
                    tool_result(
                        id,
                        serde_json::to_value(
                            targets
                                .into_iter()
                                .map(PublicTarget::from)
                                .collect::<Vec<_>>(),
                        )
                        .expect("public targets are serializable"),
                    )
                }
                Err(error) => {
                    warn!(
                        target: "webssh_rs_server::mcp",
                        tool = %tool_name,
                        request_id = ?id,
                        elapsed_ms = started_at.elapsed().as_millis() as u64,
                        error = %error,
                        "MCP tool call failed"
                    );
                    tool_error(id, format!("failed to list targets: {error}"))
                }
            }
        }
        "execute_command" => {
            let arguments =
                match serde_json::from_value::<ExecuteCommandArguments>(params.arguments) {
                    Ok(arguments) => arguments,
                    Err(error) => {
                        warn!(
                            target: "webssh_rs_server::mcp",
                            tool = %tool_name,
                            request_id = ?id,
                            elapsed_ms = started_at.elapsed().as_millis() as u64,
                            error = %error,
                            "MCP tool call rejected: invalid arguments"
                        );
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
                Err(error) => {
                    warn!(
                        target: "webssh_rs_server::mcp",
                        tool = %tool_name,
                        request_id = ?id,
                        target_id = arguments.target_id,
                        elapsed_ms = started_at.elapsed().as_millis() as u64,
                        error = %error,
                        "MCP tool call failed to open SSH channel"
                    );
                    return tool_error(id, error.to_string());
                }
            };
            info!(
                target: "webssh_rs_server::mcp",
                tool = %tool_name,
                request_id = ?id,
                target_id = arguments.target_id,
                command = %arguments.command,
                "MCP executing SSH command"
            );
            match ssh::exec(channel, &arguments.command).await {
                Ok(output) => {
                    info!(
                        target: "webssh_rs_server::mcp",
                        tool = %tool_name,
                        request_id = ?id,
                        target_id = arguments.target_id,
                        elapsed_ms = started_at.elapsed().as_millis() as u64,
                        "MCP tool call completed"
                    );
                    tool_result(id, json!(output))
                }
                Err(error) => {
                    warn!(
                        target: "webssh_rs_server::mcp",
                        tool = %tool_name,
                        request_id = ?id,
                        target_id = arguments.target_id,
                        elapsed_ms = started_at.elapsed().as_millis() as u64,
                        error = %error.message,
                        "MCP tool call failed"
                    );
                    tool_error(id, error.message)
                }
            }
        }
        "upload_file" => {
            let arguments = match serde_json::from_value::<UploadFileArguments>(params.arguments) {
                Ok(arguments) => arguments,
                Err(error) => {
                    warn!(
                        target: "webssh_rs_server::mcp",
                        tool = %tool_name,
                        request_id = ?id,
                        elapsed_ms = started_at.elapsed().as_millis() as u64,
                        error = %error,
                        "MCP tool call rejected: invalid arguments"
                    );
                    return tool_error(id, format!("invalid upload_file arguments: {error}"));
                }
            };

            if !arguments.remote_path.starts_with('/') {
                return tool_error(
                    id,
                    "invalid upload_file arguments: remote_path must be absolute".to_string(),
                );
            }

            let target_uri = format!("sftp:{}:{}", arguments.target_id, arguments.remote_path);
            let task = match state
                .transfer_service
                .create_upload(CreateUploadTaskPayload {
                    local_path: arguments.local_path,
                    target_uri,
                })
                .await
            {
                Ok(task) => task,
                Err(error) => {
                    warn!(
                        target: "webssh_rs_server::mcp",
                        tool = %tool_name,
                        request_id = ?id,
                        target_id = arguments.target_id,
                        elapsed_ms = started_at.elapsed().as_millis() as u64,
                        error = %error,
                        "MCP tool call failed"
                    );
                    return tool_error(id, format!("failed to create upload task: {error}"));
                }
            };

            info!(
                target: "webssh_rs_server::mcp",
                tool = %tool_name,
                request_id = ?id,
                target_id = arguments.target_id,
                task_id = %task.id,
                elapsed_ms = started_at.elapsed().as_millis() as u64,
                "MCP upload task created"
            );
            tool_result(id, transfer_task_value(task))
        }
        "get_transfer_task" => {
            let arguments =
                match serde_json::from_value::<GetTransferTaskArguments>(params.arguments) {
                    Ok(arguments) => arguments,
                    Err(error) => {
                        warn!(
                            target: "webssh_rs_server::mcp",
                            tool = %tool_name,
                            request_id = ?id,
                            elapsed_ms = started_at.elapsed().as_millis() as u64,
                            error = %error,
                            "MCP tool call rejected: invalid arguments"
                        );
                        return tool_error(
                            id,
                            format!("invalid get_transfer_task arguments: {error}"),
                        );
                    }
                };

            match state
                .transfer_service
                .get_task_model(&arguments.task_id)
                .await
            {
                Ok(task) => tool_result(id, transfer_task_value(task)),
                Err(error) => {
                    warn!(
                        target: "webssh_rs_server::mcp",
                        tool = %tool_name,
                        request_id = ?id,
                        task_id = %arguments.task_id,
                        elapsed_ms = started_at.elapsed().as_millis() as u64,
                        error = %error,
                        "MCP transfer task query failed"
                    );
                    tool_error(id, format!("failed to query transfer task: {error}"))
                }
            }
        }
        _ => {
            warn!(
                target: "webssh_rs_server::mcp",
                tool = %tool_name,
                request_id = ?id,
                elapsed_ms = started_at.elapsed().as_millis() as u64,
                "MCP tool call rejected: unknown tool"
            );
            tool_error(id, format!("unknown tool: {}", tool_name))
        }
    }
}

fn transfer_task_value(task: TransferTaskModel) -> Value {
    json!({
        "task_id": task.id,
        "status": task.status,
        "local_path": task.local_path,
        "target_uri": task.target_uri,
        "loaded": task.loaded,
        "total": task.total,
        "percent": task.percent,
        "speed": task.speed,
        "estimated_time": task.estimated_time,
        "fail_reason": task.fail_reason,
    })
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
