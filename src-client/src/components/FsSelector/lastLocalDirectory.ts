const LAST_LOCAL_DIRECTORY_STORAGE_KEY =
    "webssh-rs:fs-selector:last-local-directory";

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

let inMemoryDirectory: string | undefined;

export function getLastLocalDirectory(storage?: StorageReader) {
    try {
        return storage
            ? storage.getItem(LAST_LOCAL_DIRECTORY_STORAGE_KEY) || undefined
            : inMemoryDirectory;
    } catch {
        return undefined;
    }
}

export function setLastLocalDirectory(path: string, storage?: StorageWriter) {
    if (!path) return;

    try {
        if (storage) {
            storage.setItem(LAST_LOCAL_DIRECTORY_STORAGE_KEY, path);
        } else {
            inMemoryDirectory = path;
        }
    } catch {
        // The file selector still works when browser storage is unavailable.
    }
}
