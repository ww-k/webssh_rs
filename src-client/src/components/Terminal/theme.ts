import { defaultTheme } from "./constants";

import type { Terminal } from "@xterm/xterm";
import type { TerminalTheme } from "./types";

export function applyTerminalTheme(
    theme: TerminalTheme,
    terminal?: Terminal,
): void {
    document.documentElement.style.setProperty(
        "--terminal-background",
        theme.background || defaultTheme.background || "",
    );
    document.documentElement.style.setProperty(
        "--terminal-scrollbar-thumb",
        theme.scrollbarThumb || defaultTheme.scrollbarThumb || "",
    );
    if (terminal) terminal.options.theme = theme;
}
