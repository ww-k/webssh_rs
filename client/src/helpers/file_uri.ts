export function isSftpFileUri(uri: string) {
    // sftp:1:/Users/test
    return uri.startsWith("sftp:");
}

export function isFileUri(uri: string) {
    // file:///Users/test
    return uri.startsWith("file:");
}

/**
 * uri: sftp:1:/Users/test
 * return: /Users/test
 */
export function getFilePath(uri: string) {
    if (isSftpFileUri(uri)) {
        const items = uri.split(":");
        return items.slice(2).join(":");
    } else if (isFileUri(uri)) {
        return uri.substring(7);
    }
    return uri;
}

/**
 * uri: sftp:1:/Users/test
 * return: sftp:1:/Users
 */
export function getParentDirUri(uri: string) {
    const items = uri.split("/");
    items.pop();
    return items.join("/");
}
