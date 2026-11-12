import { invoke, isTauri } from "@tauri-apps/api/core";

export const DEFAULT_SERVER_PORT = 10086;

export function isDesktopApp() {
    return isTauri();
}

export async function getServerPort(): Promise<number> {
    if (!isDesktopApp()) return DEFAULT_SERVER_PORT;
    return invoke<number>("get_server_port");
}

export async function setServerPort(port: number): Promise<void> {
    if (!isDesktopApp()) return;
    await invoke("set_server_port", { port });
}
