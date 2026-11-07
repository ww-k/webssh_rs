import { defaultTheme } from "./constants";

import type { WTerm } from "@wterm/dom";
import type { TerminalTheme } from "./types";

const defaultPalette = [
    0x1e1e1e, 0xf44747, 0x6a9955, 0xd7ba7d, 0x569cd6, 0xc586c0, 0x4ec9b0,
    0xd4d4d4, 0x808080, 0xf44747, 0x6a9955, 0xd7ba7d, 0x569cd6, 0xc586c0,
    0x4ec9b0, 0xffffff,
];

function colorToRgb(value: string, fallback: string): number {
    const normalized = value.trim().replace(/^#/, "");
    const hex =
        normalized.length === 3
            ? normalized
                  .split("")
                  .map((part) => `${part}${part}`)
                  .join("")
            : normalized;
    if (/^[\da-f]{6}$/i.test(hex)) return Number.parseInt(hex, 16);
    return Number.parseInt(fallback.replace(/^#/, ""), 16);
}

export function applyTerminalTheme(
    theme: TerminalTheme,
    terminal?: WTerm,
): void {
    const background = theme.background || defaultTheme.background;
    const foreground = theme.foreground || defaultTheme.foreground;
    const cursor = theme.cursor || defaultTheme.cursor;
    const host = terminal?.element || document.documentElement;
    document.documentElement.style.setProperty(
        "--terminal-background",
        background,
    );
    document.documentElement.style.setProperty(
        "--terminal-scrollbar-thumb",
        theme.scrollbarThumb || defaultTheme.scrollbarThumb,
    );
    host.style.setProperty("--term-bg", background);
    host.style.setProperty("--term-fg", foreground);
    host.style.setProperty("--term-cursor", cursor);
    host.style.setProperty(
        "--term-selection-bg",
        theme.selectionBackground || defaultTheme.selectionBackground,
    );
    terminal?.setThemeColors({
        background: colorToRgb(background, defaultTheme.background),
        foreground: colorToRgb(foreground, defaultTheme.foreground),
        cursor: colorToRgb(cursor, defaultTheme.cursor),
        palette: defaultPalette,
    });
}
