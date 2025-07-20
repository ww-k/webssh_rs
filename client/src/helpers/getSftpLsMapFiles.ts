import { getSftpLs } from "@/api";

import type { IFile } from "@/types";

export default async function getSftpLsMapFiles(fileUri: string) {
    const sftpFiles = await getSftpLs(fileUri);
    const files: IFile[] = sftpFiles.map((item) => ({
        ...item,
        mtime: item.mtime * 1000,
        atime: item.atime * 1000,
        isDir: item.type === "d",
        uri: `${fileUri}/${item.name}`,
        sortName: item.name.toLowerCase(),
    }));
    return files;
}
