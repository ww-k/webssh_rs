import axios from "axios";

export interface ISftpFile {
    /** 文件名 */
    name: string;
    /** 文件所在目录路径 */
    type: "f" | "d" | "l" | "?";
    /** 文件大小 */
    size: number;
    /** 最近访问时间 */
    atime: number;
    /** 最近修改时间 */
    mtime: number;
    /** 权限 */
    permissions: string;
}

export async function getSftpLs(uri: string) {
    const response = await axios.get<ISftpFile[]>("/api/sftp/ls", {
        params: {
            uri,
        },
    });
    return response.data;
}
