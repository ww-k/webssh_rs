export function isFileUri(uri: string) {
    return uri.startsWith("sftp:");
}

export function getParentDirUri(uri: string) {
    const items = uri.split("/");
    items.pop();
    return items.join("/");
}
