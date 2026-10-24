import type { ClipboardOptions, TerminalTheme } from "./types";

export const terminalContextMenuMessageType = "webssh:terminal-contextmenu";
export const terminalInteractionMessageType = "webssh:terminal-interaction";

export const defaultTheme: TerminalTheme = {
    background: "#0f1115",
    foreground: "#f5f7fa",
    cursor: "#f5f7fa",
    selectionBackground: "#3a4352",
    scrollbarThumb: "rgba(255, 255, 255, 0.3)",
};

export const defaultClipboardOptions: ClipboardOptions = {
    selectionCopyEnabled: true,
    rightClickAction: "paste",
    middleClickPasteEnabled: true,
};

export const defaultMaxDisconnectionDuration = 5 * 60000;
