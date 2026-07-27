const LAST_LOCAL_DIRECTORY_STORAGE_KEY =
    "webssh-rs:fs-selector:last-local-directory";

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

export function getLastLocalDirectory(
    storage: StorageReader | undefined = getLocalStorage(),
) {
    try {
        return storage?.getItem(LAST_LOCAL_DIRECTORY_STORAGE_KEY) || undefined;
    } catch {
        return undefined;
    }
}

export function setLastLocalDirectory(
    path: string,
    storage: StorageWriter | undefined = getLocalStorage(),
) {
    if (!path) return;

    try {
        storage?.setItem(LAST_LOCAL_DIRECTORY_STORAGE_KEY, path);
    } catch {
        // The file selector still works when browser storage is unavailable.
    }
}

function getLocalStorage() {
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}
