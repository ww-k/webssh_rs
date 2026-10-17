/**
 * Parse a terminal OSC 7 payload into an absolute remote path.
 * Shell integrations commonly send file://host/path or ssh://host/path.
 */
export function parseTerminalCwd(payload: string): string | undefined {
    const value = payload.trim();
    if (!value) return;

    let path: string;
    try {
        if (value.includes("://")) {
            path = decodeURIComponent(new URL(value).pathname);
        } else {
            path = decodeURIComponent(value);
        }
    } catch {
        return;
    }

    if (!path.startsWith("/")) return;
    if (path.length > 1 && path.endsWith("/")) {
        path = path.replace(/\/+$/, "");
    }
    return path || "/";
}

export function normalizeTerminalCwd(cwd: string): string | undefined {
    const path = cwd.trim();
    if (!path.startsWith("/")) return;
    if (path.length === 1) return "/";
    return path.replace(/\/+$/, "");
}
