pub const ERR_CODE_DB_ERR: u32 = 1;

pub const ERR_CODE_JSON_ERR: u32 = 2;

/// 用户数据 URL 导入需要解密密码
pub const ERR_CODE_USER_DATA_PASSWORD_REQUIRED: u32 = 6000;

/// 用户数据解密失败
pub const ERR_CODE_USER_DATA_DECRYPT_FAILED: u32 = 6001;

/// 用户数据 URL 获取失败
pub const ERR_CODE_USER_DATA_URL_FETCH_FAILED: u32 = 6002;

/// 用户数据 URL 无效
pub const ERR_CODE_USER_DATA_URL_INVALID: u32 = 6003;

/// URL 返回的用户数据格式错误
pub const ERR_CODE_USER_DATA_URL_FORMAT: u32 = 6004;

/// SSH 连接错误
pub const ERR_CODE_SSH_ERR: u32 = 1000;

/// SSH 执行命令错误
pub const ERR_CODE_SSH_EXEC: u32 = 1001;

pub const ERR_CODE_SFTP_INVALID_URI: u32 = 2000;

/// SFTP 上传请求不合法
pub const ERR_CODE_SFTP_UPLOAD_INVALID_REQUEST: u32 = 2001;

/// SFTP 下载请求不合法
pub const ERR_CODE_SFTP_DOWNLOAD_INVALID_REQUEST: u32 = 2002;

/// 本机文件操作请求不合法
pub const ERR_CODE_FS_INVALID_REQUEST: u32 = 3000;

/// 本机文件操作错误
pub const ERR_CODE_FS_IO_ERR: u32 = 3001;

/// 文件传输任务请求不合法
pub const ERR_CODE_TRANSFER_INVALID_REQUEST: u32 = 4000;

/// 文件传输任务不存在
pub const ERR_CODE_TRANSFER_NOT_FOUND: u32 = 4001;

/// 文件传输任务执行失败
pub const ERR_CODE_TRANSFER_ERR: u32 = 4002;

/// 收藏目录请求不合法
pub const ERR_CODE_FAVORITE_DIRECTORY_INVALID_REQUEST: u32 = 5000;
