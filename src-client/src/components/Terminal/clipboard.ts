import {
    terminalContextMenuMessageType,
    terminalInteractionMessageType,
} from "./constants";

import type { WTerm } from "@wterm/dom";
import type { ClipboardOptions } from "./types";

export function copyTerminalSelection(
    terminal: WTerm | undefined,
    targetId: number,
    fallback = "",
): void {
    const text = terminal?.getSelectionText() || fallback;
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

export function pasteFromClipboard(terminal: WTerm | undefined): void {
    if (!terminal) return;
    void navigator.clipboard.readText().then((text) => {
        terminal.onData?.(text);
    });
}

export function enhanceMouseCopyPaste(
    terminal: WTerm,
    targetId: number,
    getOptions: () => ClipboardOptions,
    onContextMenuSelection: (selection: string) => void,
): void {
    let contextMenuSelection = "";

    document.addEventListener("selectionchange", () => {
        if (!getOptions().selectionCopyEnabled) return;
        if (terminal.getSelectionText()) {
            copyTerminalSelection(terminal, targetId);
        }
    });

    document.addEventListener(
        "pointerdown",
        (event) => {
            window.parent.postMessage(
                {
                    type: terminalInteractionMessageType,
                    targetId,
                },
                window.location.origin,
            );

            if (event.button === 2) {
                contextMenuSelection = terminal.getSelectionText() || "";
                onContextMenuSelection(contextMenuSelection);
            }

            const options = getOptions();
            if (
                (event.button === 1 && options.middleClickPasteEnabled) ||
                (event.button === 2 && options.rightClickAction === "paste")
            ) {
                pasteFromClipboard(terminal);
            }
        },
        true,
    );

    document.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (getOptions().rightClickAction === "paste") return;
        const selection = terminal.getSelectionText() || contextMenuSelection;
        window.parent.postMessage(
            {
                type: terminalContextMenuMessageType,
                targetId,
                x: event.clientX,
                y: event.clientY,
                hasSelection: selection !== "",
                selection,
            },
            window.location.origin,
        );
    });
}
