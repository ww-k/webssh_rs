import { getFilePath, parseSftpUri } from "@/helpers/file_uri";

import type { IFavoriteDirectory } from "@/api";

export function getFavoriteDirectoryLocation(uri: string) {
    const parsed = parseSftpUri(uri);
    return {
        targetId: parsed?.targetId ?? 0,
        path: getFilePath(uri),
    };
}

export function favoriteDirectoryToQuickLink(
    favoriteDirectory: IFavoriteDirectory,
) {
    return {
        name: favoriteDirectory.name,
        path:
            favoriteDirectory.target_id === 0
                ? favoriteDirectory.path
                : `sftp:${favoriteDirectory.target_id}:${favoriteDirectory.path}`,
    };
}

export function getFavoriteDirectoryDefaultName(uri: string) {
    const filePath = getFilePath(uri);
    const pathWithoutTrailingSeparator = filePath.replace(/[\\/]+$/, "");
    return pathWithoutTrailingSeparator.split(/[\\/]/).pop() || filePath;
}
