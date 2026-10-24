import type {
    ClipboardOptions,
    TerminalTheme,
    TerminalThemeColors,
} from "./types";

export const terminalContextMenuMessageType = "webssh:terminal-contextmenu";
export const terminalInteractionMessageType = "webssh:terminal-interaction";

export const terminalThemeDefaults: Record<
    "light" | "dark",
    TerminalThemeColors
> = {
    dark: {
        background: "#0f1115",
        foreground: "#f5f7fa",
        cursor: "#f5f7fa",
        selectionBackground: "#3a4352",
        scrollbarThumb: "rgba(255, 255, 255, 0.3)",
    },
    light: {
        background: "#ffffff",
        foreground: "#1f2328",
        cursor: "#1f2328",
        selectionBackground: "#add6ff",
        scrollbarThumb: "rgba(0, 0, 0, 0.25)",
    },
};

export const defaultTheme: TerminalTheme = {
    ...terminalThemeDefaults.dark,
};

export const defaultClipboardOptions: ClipboardOptions = {
    selectionCopyEnabled: true,
    rightClickAction: "paste",
    middleClickPasteEnabled: true,
};

export const defaultMaxDisconnectionDuration = 5 * 60000;
