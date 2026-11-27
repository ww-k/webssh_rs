/// <reference types="@rsbuild/core/types" />

declare module "@wterm/dom/css";

interface WebsshDesktopBridge {
    getServerPort(): Promise<number>;
    setServerPort(port: number): Promise<void>;
}

interface Window {
    websshDesktop?: WebsshDesktopBridge;
}
