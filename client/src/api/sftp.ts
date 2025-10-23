import axios from "axios";

import type {
    AxiosProgressEvent,
    AxiosRequestConfig,
    GenericAbortSignal,
} from "axios";

export interface ISftpFileStat {
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
    const response = await axios.get<ISftpFileStat[]>("/api/sftp/ls", {
        params: {
            uri,
        },
    });
    return response.data;
}

export async function getSftpHome(target_id: number): Promise<string> {
    const response = await axios.get<string>("/api/sftp/home", {
        params: {
            target_id,
        },
    });
    return response.data;
}

export async function postSftpMkdir(uri: string) {
    await axios.post<boolean>("/api/sftp/mkdir", null, {
        params: {
            uri,
        },
    });
    return true;
}

export async function postSftpCp(uri: string, targetPath: string) {
    await axios.post<boolean>("/api/sftp/cp", null, {
        params: {
            uri,
            target_path: targetPath,
        },
    });
    return true;
}

export async function postSftpRename(uri: string, newPath: string) {
    await axios.post<boolean>("/api/sftp/rename", null, {
        params: {
            uri,
            target_path: newPath,
        },
    });
    return true;
}

export async function postSftpRm(uri: string) {
    await axios.post<boolean>("/api/sftp/rm", null, {
        params: {
            uri,
        },
    });
    return true;
}

export async function postSftpRmRf(uri: string) {
    await axios.post<boolean>("/api/sftp/rm/rf", null, {
        params: {
            uri,
        },
    });
    return true;
}

export async function getSftpStat(uri: string) {
    const response = await axios.get<ISftpFileStat>("/api/sftp/stat", {
        params: {
            uri,
        },
    });
    return response.data;
}

export async function postSftpUpload(
    fileUri: string,
    fileSlice: File | Blob | string,
    option?: {
        start?: number;
        end?: number;
        /** 文件总大小, 非分片大小 */
        size?: number;
        // browser only
        onUploadProgress?: (progressEvent: AxiosProgressEvent) => void;
        signal?: GenericAbortSignal;
    },
) {
    const config: AxiosRequestConfig = {
        headers: {
            "content-type": "application/octet-stream",
        },
    };
    if (option) {
        if (
            config.headers &&
            typeof option.start === "number" &&
            typeof option.end === "number" &&
            typeof option.size === "number"
        ) {
            config.headers["content-range"] =
                `bytes ${option.start}-${option.end}/${option.size}`;
            config.timeout = Math.max(
                Math.ceil((option.end - option.start + 1) / 5),
                30000,
            );
        }
        if (option.onUploadProgress) {
            config.onUploadProgress = option.onUploadProgress;
        }
    }
    const response = await axios.post<{
        hash: string;
    }>(
        `/api/sftp/upload?uri=${encodeURIComponent(fileUri)}`,
        fileSlice,
        config,
    );
    return response.data;
}

export async function getSftpDownload(
    fileUri: string,
    option?: {
        start?: number;
        end?: number;
        responseType?: ResponseType;
        /** 是否静默请求。如果是，则接口报错也不弹出通知框 */
        silence?: boolean;
        onDownloadProgress?: (progressEvent: AxiosProgressEvent) => void;
        signal?: GenericAbortSignal;
    },
) {
    const config: AxiosRequestConfig = {
        headers: {
            "content-type": "application/octet-stream",
        },
        responseType: "blob",
    };
    if (option) {
        if (
            config.headers &&
            typeof option.start === "number" &&
            typeof option.end === "number"
        ) {
            config.headers.range = `bytes=${option.start}-${option.end}`;
        }
        if (option.onDownloadProgress) {
            config.onDownloadProgress = option.onDownloadProgress;
        }
        if (option.signal) {
            config.signal = option.signal;
        }
    }
    const response = await axios.get<Blob>(
        `/api/sftp/download?uri=${encodeURIComponent(fileUri)}`,
        config,
    );
    return response.data;
}
