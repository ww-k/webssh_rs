import axios from "axios";

export interface IFsFileStat {
    name: string;
    path: string;
    type: "f" | "d" | "l" | "?";
    size?: number;
    atime?: number;
    mtime?: number;
    permissions: string;
}

export async function getFsLs(path: string) {
    const response = await axios.get<IFsFileStat[]>("/api/fs/ls", {
        params: {
            path,
        },
    });
    return response.data;
}

export async function getFsStat(path: string) {
    const response = await axios.get<IFsFileStat>("/api/fs/stat", {
        params: {
            path,
        },
    });
    return response.data;
}

export async function postFsMkdir(path: string) {
    await axios.post("/api/fs/mkdir", null, {
        params: {
            path,
        },
    });
}

export async function postFsCp(path: string, targetPath: string) {
    await axios.post("/api/fs/cp", null, {
        params: {
            path,
            target_path: targetPath,
        },
    });
}

export async function postFsRename(path: string, targetPath: string) {
    await axios.post("/api/fs/rename", null, {
        params: {
            path,
            target_path: targetPath,
        },
    });
}

export async function postFsRm(path: string) {
    await axios.post("/api/fs/rm", null, {
        params: {
            path,
        },
    });
}

export async function postFsRmRf(path: string) {
    await axios.post("/api/fs/rm/rf", null, {
        params: {
            path,
        },
    });
}
