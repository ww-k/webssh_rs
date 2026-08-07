use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::apis::target::handlers::target_list,
        crate::apis::target::handlers::target_add,
        crate::apis::target::handlers::target_update,
        crate::apis::target::handlers::target_remove,
        crate::apis::favorite::handlers::favorite_list,
        crate::apis::favorite::handlers::favorite_add,
        crate::apis::favorite::handlers::favorite_remove,
        crate::apis::ssh_connection::handlers::list,
        crate::apis::ssh_connection::handlers::expire,
        crate::apis::ssh::handlers::exec_handler,
        crate::apis::sftp::handlers::ls,
        crate::apis::sftp::handlers::mkdir,
        crate::apis::sftp::handlers::stat,
        crate::apis::sftp::handlers::user_dirs,
        crate::apis::sftp::handlers::user_dir_home,
        crate::apis::sftp::handlers::cp,
        crate::apis::sftp::handlers::rename,
        crate::apis::sftp::handlers::rm,
        crate::apis::sftp::handlers::rm_rf,
        crate::apis::sftp::handlers::upload,
        crate::apis::sftp::handlers::download,
        crate::apis::fs::handlers::ls,
        crate::apis::fs::handlers::user_dir_home,
        crate::apis::fs::handlers::user_dir_download,
        crate::apis::fs::handlers::user_dirs,
        crate::apis::fs::handlers::stat,
        crate::apis::fs::handlers::mkdir,
        crate::apis::fs::handlers::cp,
        crate::apis::fs::handlers::rename,
        crate::apis::fs::handlers::rm,
        crate::apis::fs::handlers::rm_rf,
        crate::apis::fs::handlers::show_in_folder,
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
            crate::entities::favorite_directory::Model,
            crate::apis::fs::FsFile,
            crate::apis::fs::FsUserDir,
            crate::apis::sftp::SftpUserDir,
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
        (name = "favorite", description = "文件路径收藏 API"),
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
