import { getFilePath, parseSftpUri } from "@/helpers/file_uri";

import type { IFavorite } from "@/api";

export function getFavoriteLocation(uri: string) {
    const parsed = parseSftpUri(uri);
    return {
        targetId: parsed?.targetId ?? 0,
        path: getFilePath(uri),
    };
}

export function favoriteToQuickLink(favorite: IFavorite) {
    return {
        name: favorite.name,
        path:
            favorite.target_id === 0
                ? favorite.path
                : `sftp:${favorite.target_id}:${favorite.path}`,
    };
}

export function getFavoriteDefaultName(uri: string) {
    const filePath = getFilePath(uri);
    const pathWithoutTrailingSeparator = filePath.replace(/[\\/]+$/, "");
    return pathWithoutTrailingSeparator.split(/[\\/]/).pop() || filePath;
}
