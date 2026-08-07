import { getFsLs } from "@/api";
import { getFilePath } from "@/helpers/file_uri";
import { posix, win32 } from "@/helpers/path";
import { isMSWindows } from "@/helpers/platform";

import type { IViewFileStat } from "@/types";

export default async function getFsLsMapFiles(path: string) {
    const cwd = normalizeLocalPath(getFilePath(path));
    const fsFiles = await getFsLs(cwd);
    const files: IViewFileStat[] = fsFiles.map((item) => ({
        ...item,
        size: item.size || 0,
        mtime: (item.mtime || 0) * 1000,
        atime: (item.atime || 0) * 1000,
        isDir: item.type === "d",
        uri: joinLocalPath(cwd, item.name),
        sortName: item.name.toLowerCase(),
    }));
    return files;
}

export function normalizeLocalPath(path: string) {
    if (isMSWindows && /^[a-zA-Z]:$/.test(path)) {
        return `${path}\\`;
    }
    return path;
}

function joinLocalPath(parent: string, name: string) {
    if (isMSWindows) {
        if (parent === "/") {
            return normalizeLocalPath(name);
        }
        return normalizeLocalPath(win32.join(parent, name));
    }
    return posix.join(parent, name);
}
