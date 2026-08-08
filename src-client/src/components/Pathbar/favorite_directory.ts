import { getFilePath, parseSftpUri } from "@/helpers/file_uri";

import type { IFavoriteDirectory } from "@/api";

export interface IFavoriteDirectoryMenuItem {
    name: string;
    path: string;
    isDefault: boolean;
}

export type FavoriteDirectoryDefaultKind =
    | "/"
    | "Home"
    | "Desktop"
    | "Documents"
    | "Downloads";

export function getFavoriteDirectoryLocation(uri: string) {
    const parsed = parseSftpUri(uri);
    return {
        targetId: parsed?.targetId ?? 0,
        path: getFilePath(uri),
    };
}

export function favoriteDirectoryToMenuItem(
    favoriteDirectory: IFavoriteDirectory,
): IFavoriteDirectoryMenuItem {
    return {
        name: favoriteDirectory.name,
        path:
            favoriteDirectory.target_id === 0
                ? favoriteDirectory.path
                : `sftp:${favoriteDirectory.target_id}:${favoriteDirectory.path}`,
        isDefault: favoriteDirectory.is_default,
    };
}

export function appendFavoriteDirectoryMenuItem(
    items: IFavoriteDirectoryMenuItem[],
    item: IFavoriteDirectoryMenuItem,
) {
    if (items.some((current) => current.path === item.path)) return items;
    return [...items, item];
}

export function getFavoriteDirectoryDefaultKind({
    name,
    isDefault,
}: Pick<IFavoriteDirectoryMenuItem, "name" | "isDefault">) {
    if (!isDefault) return null;

    switch (name) {
        case "/":
        case "Home":
        case "Desktop":
        case "Documents":
        case "Downloads":
            return name as FavoriteDirectoryDefaultKind;
        default:
            return null;
    }
}

export function getFavoriteDirectoryDefaultName(uri: string) {
    const filePath = getFilePath(uri);
    const pathWithoutTrailingSeparator = filePath.replace(/[\\/]+$/, "");
    return pathWithoutTrailingSeparator.split(/[\\/]/).pop() || filePath;
}
