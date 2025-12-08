use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::apis::target::target_list,
        crate::apis::target::target_add,
        crate::apis::target::target_update,
        crate::apis::target::target_remove,
        crate::apis::handlers::ssh_connection::list::handler,
        crate::apis::handlers::ssh_connection::expire::handler,
        crate::apis::handlers::ssh::exec::handler,
        crate::apis::handlers::sftp::ls::handler,
        crate::apis::handlers::sftp::mkdir::handler,
        crate::apis::handlers::sftp::stat::handler,
        crate::apis::handlers::sftp::home::handler,
        crate::apis::handlers::sftp::cp::handler,
        crate::apis::handlers::sftp::rename::handler,
        crate::apis::handlers::sftp::rm::handler,
        crate::apis::handlers::sftp::rm_rf::handler,
        crate::apis::handlers::sftp::upload::handler,
        crate::apis::handlers::sftp::download::handler,
    ),
    components(
        schemas(
            crate::entities::target::Model,
            crate::entities::target::TargetAuthMethod,
            crate::apis::target::TargetUpdatePayload,
            crate::apis::target::TargetRemovePayload,
            crate::ssh_session_pool::ConnectionInfo,
            crate::apis::ApiErr,
            crate::apis::handlers::sftp::SftpFile,
            crate::apis::handlers::sftp::upload::SftpUploadResponse,
        )
    ),
    tags(
        (name = "target", description = "SSH 目标管理 API"),
        (name = "ssh_connection", description = "SSH 连接管理 API"),
        (name = "ssh", description = "SSH 命令执行 API"),
        (name = "sftp", description = "SFTP 文件管理 API")
    ),
    info(
        title = "WebSSH RS API",
        description = "WebSSH RS 后端 API 文档",
        version = "0.1.0",
        contact(
            name = "API Support",
        )
    )
)]
pub struct ApiDoc;
