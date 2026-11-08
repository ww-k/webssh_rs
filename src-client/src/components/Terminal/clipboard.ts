import type { WTerm } from "@wterm/dom";
import type { ClipboardOptions } from "./types";

export interface TerminalClipboardCallbacks {
    onCopy: () => void;
    onInteraction: () => void;
    onContextMenu: (data: {
        x: number;
        y: number;
        hasSelection: boolean;
        selection: string;
    }) => void;
}

export function copyTerminalSelection(
    terminal: WTerm | undefined,
    fallback = "",
    onCopy?: () => void,
): void {
    const text = terminal?.getSelectionText() || fallback;
    if (!text) return;

    void navigator.clipboard.writeText(text).then(() => {
        onCopy?.();
    });
}

export function pasteFromClipboard(terminal: WTerm | undefined): void {
    if (!terminal) return;
    void navigator.clipboard
        .readText()
        .then((text) => {
            terminal.onData?.(text);
        })
        .finally(() => {
            terminal.focus();
        });
}

export function enhanceMouseCopyPaste(
    terminal: WTerm,
    getOptions: () => ClipboardOptions,
    onContextMenuSelection: (selection: string) => void,
    callbacks: TerminalClipboardCallbacks,
): () => void {
    let contextMenuSelection = "";

    const onSelectionChange = () => {
        if (!getOptions().selectionCopyEnabled) return;
        if (terminal.getSelectionText()) {
            copyTerminalSelection(terminal, "", callbacks.onCopy);
        }
    };

    const onPointerDown = (event: PointerEvent) => {
        if (
            !(event.target instanceof Node) ||
            !terminal.element.contains(event.target)
        ) {
            return;
        }

        terminal.focus();
        callbacks.onInteraction();

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
    };

    const onContextMenu = (event: MouseEvent) => {
        if (
            !(event.target instanceof Node) ||
            !terminal.element.contains(event.target)
        ) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        if (getOptions().rightClickAction === "paste") return;
        const selection = terminal.getSelectionText() || contextMenuSelection;
        callbacks.onContextMenu({
            x: event.clientX,
            y: event.clientY,
            hasSelection: selection !== "",
            selection,
        });
    };

    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("contextmenu", onContextMenu);

    return () => {
        document.removeEventListener("selectionchange", onSelectionChange);
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("contextmenu", onContextMenu);
    };
}
