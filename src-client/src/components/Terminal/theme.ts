import { defaultTheme } from "./constants";

import type { WTerm } from "@wterm/dom";
import type { TerminalTheme } from "./types";

export function applyTerminalTheme(
    theme: TerminalTheme,
    terminal: WTerm,
): void {
    const background = theme.background || defaultTheme.background;
    const foreground = theme.foreground || defaultTheme.foreground;
    const cursor = theme.cursor || defaultTheme.cursor;
    const host = terminal.element;
    host.style.setProperty("--term-bg", background);
    host.style.setProperty("--term-fg", foreground);
    host.style.setProperty("--term-cursor", cursor);
    host.style.setProperty(
        "--term-selection-bg",
        theme.selectionBackground || defaultTheme.selectionBackground,
    );
}
