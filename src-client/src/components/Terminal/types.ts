import type { ITheme } from "@xterm/xterm";
import type { Socket } from "socket.io-client";

export type TerminalTheme = ITheme & {
    scrollbarThumb?: string;
};

export interface ClipboardOptions {
    selectionCopyEnabled: boolean;
    rightClickPasteEnabled: boolean;
    middleClickPasteEnabled: boolean;
}

export interface TerminalSize {
    col: number;
    row: number;
}

export interface ServerReadyOption {
    maxDisconnectionDuration?: number;
}

export interface TerminalSocketCallbacks {
    onConnect: (socket: Socket, recovered: boolean) => void;
    onDisconnect: (reason: string) => void;
    onConnectError: (error: Error) => void;
    onServerReady: (option: ServerReadyOption) => void;
    onOutput: (data: string) => void;
}
