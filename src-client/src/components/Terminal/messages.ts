export function postTerminalMessage(message: Record<string, unknown>): void {
    window.parent.postMessage(message, window.location.origin);
}

export function postConnectionStatus(
    targetId: number,
    status: "connected" | "disconnected",
): void {
    postTerminalMessage({
        type: "webssh:terminal-status",
        targetId,
        status,
    });
}
