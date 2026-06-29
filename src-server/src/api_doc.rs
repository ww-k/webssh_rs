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
        crate::apis::fs::handlers::ls,
        crate::apis::fs::handlers::stat,
        crate::apis::fs::handlers::mkdir,
        crate::apis::fs::handlers::cp,
        crate::apis::fs::handlers::rename,
        crate::apis::fs::handlers::rm,
        crate::apis::fs::handlers::rm_rf,
        crate::apis::transfer::handlers::create_upload_task,
        crate::apis::transfer::handlers::create_download_task,
        crate::apis::transfer::handlers::list_tasks,
        crate::apis::transfer::handlers::get_task,
        crate::apis::transfer::handlers::pause_task,
        crate::apis::transfer::handlers::resume_task,
        crate::apis::transfer::handlers::cancel_task,
        crate::apis::transfer::handlers::delete_task,
    ),
    components(
        schemas(
            crate::apis::ApiErr,
            crate::apis::fs::FsFile,
            crate::apis::transfer::CreateUploadTaskPayload,
            crate::apis::transfer::CreateDownloadTaskPayload,
            crate::apis::transfer::TransferTaskResponse,
            crate::entities::transfer_task::TransferTaskType,
            crate::entities::transfer_task::TransferTaskStatus,
        ),
        responses(
            crate::apis::InternalErrorResponse
        )
    ),
    tags(
        (name = "target", description = "SSH 目标管理 API"),
        (name = "ssh_connection", description = "SSH 连接管理 API"),
        (name = "ssh", description = "SSH 命令执行 API"),
        (name = "sftp", description = "SFTP 文件管理 API"),
        (name = "fs", description = "本机文件管理 API"),
        (name = "transfer", description = "文件传输任务 API")
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
