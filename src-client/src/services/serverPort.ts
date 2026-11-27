export const DEFAULT_SERVER_PORT = 10086;

export function isDesktopApp() {
    return typeof window !== "undefined" && window.websshDesktop !== undefined;
}

export async function getServerPort(): Promise<number> {
    const bridge = window.websshDesktop;
    if (!bridge) return DEFAULT_SERVER_PORT;
    return bridge.getServerPort();
}

export async function setServerPort(port: number): Promise<void> {
    const bridge = window.websshDesktop;
    if (!bridge) return;
    await bridge.setServerPort(port);
}
