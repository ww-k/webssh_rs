import { terminalContextMenuMessageType } from "./constants";

import type { Terminal } from "@xterm/xterm";
import type { ClipboardOptions } from "./types";

export function copyTerminalSelection(
    terminal: Terminal | undefined,
    targetId: number,
    fallback = "",
): void {
    const text = terminal?.getSelection() || fallback;
    if (!text) return;

    void navigator.clipboard.writeText(text).then(() => {
        window.parent.postMessage(
            {
                type: "webssh:terminal-copy",
                targetId,
            },
            window.location.origin,
        );
    });
}

export function pasteFromClipboard(terminal: Terminal | undefined): void {
    if (!terminal) return;
    void navigator.clipboard.readText().then((text) => {
        terminal.paste(text);
    });
}

export function enhanceMouseCopyPaste(
    terminal: Terminal,
    targetId: number,
    getOptions: () => ClipboardOptions,
    onContextMenuSelection: (selection: string) => void,
): void {
    let contextMenuSelection = "";

    terminal.onSelectionChange(() => {
        if (!getOptions().selectionCopyEnabled) return;
        copyTerminalSelection(terminal, targetId);
    });

    document.addEventListener(
        "pointerdown",
        (event) => {
            if (event.button === 2) {
                contextMenuSelection = terminal.getSelection() || "";
                onContextMenuSelection(contextMenuSelection);
            }

            const options = getOptions();
            if (
                (event.button === 1 && options.middleClickPasteEnabled) ||
                (event.button === 2 && options.rightClickPasteEnabled)
            ) {
                pasteFromClipboard(terminal);
            }
        },
        true,
    );

    document.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.parent.postMessage(
            {
                type: terminalContextMenuMessageType,
                targetId,
                x: event.clientX,
                y: event.clientY,
                hasSelection:
                    terminal.hasSelection() || contextMenuSelection !== "",
            },
            window.location.origin,
        );
    });
}
