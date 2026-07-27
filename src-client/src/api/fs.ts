import axios from "axios";

export interface IFsFileStat {
    /** 文件名 */
    name: string;
    /** 文件类型 */
    type: "f" | "d" | "l" | "?";
    /** 文件大小 */
    size?: number;
    /** 最近访问时间 */
    atime?: number;
    /** 最近修改时间 */
    mtime?: number;
    /** 权限 */
    permissions: string;
}

export interface IFsUserDir {
    name: "/" | "Home" | "Desktop" | "Documents" | "Downloads";
    path: string;
}

export async function getFsLs(uri: string, all?: boolean) {
    const response = await axios.get<IFsFileStat[]>("/api/fs/ls", {
        params: {
            uri,
            all,
        },
    });
    return response.data;
}

export async function getFsUserDirHome(): Promise<string> {
    const response = await axios.get<string>("/api/fs/user-dirs/home");
    return response.data;
}

export async function getFsUserDirDownload(): Promise<string> {
    const response = await axios.get<string>("/api/fs/user-dirs/download");
    return response.data;
}

export async function getFsUserDirs(): Promise<IFsUserDir[]> {
    const response = await axios.get<IFsUserDir[]>("/api/fs/user-dirs");
    return response.data;
}

export async function getFsStat(uri: string) {
    const response = await axios.get<IFsFileStat>("/api/fs/stat", {
        params: {
            uri,
        },
    });
    return response.data;
}

export async function postFsMkdir(uri: string) {
    await axios.post<boolean>("/api/fs/mkdir", null, {
        params: {
            uri,
        },
    });
    return true;
}

export async function postFsCp(uri: string, targetPath: string) {
    await axios.post<boolean>("/api/fs/cp", null, {
        params: {
            uri,
            target_path: targetPath,
        },
    });
    return true;
}

export async function postFsRename(uri: string, targetPath: string) {
    await axios.post<boolean>("/api/fs/rename", null, {
        params: {
            uri,
            target_path: targetPath,
        },
    });
    return true;
}

export async function postFsRm(uri: string) {
    await axios.post<boolean>("/api/fs/rm", null, {
        params: {
            uri,
        },
    });
    return true;
}

export async function postFsRmRf(uri: string) {
    await axios.post<boolean>("/api/fs/rm/rf", null, {
        params: {
            uri,
        },
    });
    return true;
}

export async function postFsShowInFolder(uri: string) {
    await axios.post<boolean>("/api/fs/show-in-folder", null, {
        params: {
            uri,
        },
    });
    return true;
}
