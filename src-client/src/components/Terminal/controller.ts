import { type WebMCPOptions, WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";

import { parseTerminalCwd } from "@/helpers/terminal_cwd";

import {
    copyTerminalSelection,
    enhanceMouseCopyPaste,
    pasteFromClipboard,
    type TerminalClipboardCallbacks,
} from "./clipboard";
import { defaultClipboardOptions, defaultTheme } from "./constants";
import { createTerminalSocket } from "./socket";
import { applyTerminalTheme } from "./theme";

import type { Socket } from "socket.io-client";
import type { ClipboardOptions, TerminalSize, TerminalTheme } from "./types";

function quoteShellPath(path: string): string {
    return `'${path.replace(/'/g, "'\\''")}'`;
}

export interface TerminalControllerEvents {
    onStatus?: (status: "connected" | "disconnected") => void;
    onOutput?: (data: string) => void;
    onCwd?: (cwd: string) => void;
    onCopy?: () => void;
    onInteraction?: () => void;
    onContextMenu?: TerminalClipboardCallbacks["onContextMenu"];
}

export interface TerminalControllerOptions {
    preventDocumentDrop?: boolean;
}

export class TerminalController {
    private readonly terminalContainer: HTMLElement | null;
    private readonly targetId: number;
    private readonly events: TerminalControllerEvents;
    private readonly preventDocumentDrop: boolean;
    private terminal?: WTerm;
    private terminalCreationPromise?: Promise<void>;
    private clipboardCleanup?: () => void;
    private preventDefault?: (event: DragEvent) => void;
    private destroyed = false;
    private terminalInitialized = false;
    private sizeCache?: TerminalSize;
    private terminalActive = false;
    private theme: TerminalTheme;
    private terminalSocket?: Socket;
    private terminalReady = false;
    private pendingTerminalInputs: string[] = [];
    private pendingTerminalHistory = "";
    private terminalContextMenuSelection = "";
    private terminalCwd?: string;
    private pendingTerminalCwd?: string;
    private pendingWebMCP?: WebMCPOptions;
    private clipboardOptions: ClipboardOptions = {
        ...defaultClipboardOptions,
    };
    private outputBuffer = "";

    constructor(
        containerId: string,
        targetId: number,
        events: TerminalControllerEvents = {},
        initialTheme: TerminalTheme = defaultTheme,
        options: TerminalControllerOptions = {},
    ) {
        this.terminalContainer = document.getElementById(containerId);
        this.targetId = targetId;
        this.events = events;
        this.theme = initialTheme;
        this.preventDocumentDrop = options.preventDocumentDrop === true;
    }

    init(): void {
        if (this.destroyed) return;

        if (this.preventDocumentDrop) {
            const preventDefault = (event: DragEvent) => {
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
            };

            this.preventDefault = preventDefault;
            document.body.addEventListener("dragover", preventDefault, false);
            document.body.addEventListener("drop", preventDefault, false);
        }

        this.initSocket();
    }

    reconnect(): void {
        if (this.destroyed || !this.terminalSocket) return;
        if (this.terminalSocket.connected) return;

        this.terminalReady = false;
        this.pendingTerminalCwd = this.terminalCwd;
        this.terminalSocket.connect();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        if (this.preventDefault) {
            document.body.removeEventListener(
                "dragover",
                this.preventDefault,
                false,
            );
            document.body.removeEventListener(
                "drop",
                this.preventDefault,
                false,
            );
            this.preventDefault = undefined;
        }

        this.clipboardCleanup?.();
        this.clipboardCleanup = undefined;

        this.terminalSocket?.removeAllListeners();
        this.terminalSocket?.disconnect();
        this.terminalSocket = undefined;
        this.terminal?.destroy();
        this.terminal = undefined;
        this.terminalInitialized = false;
        this.outputBuffer = "";
        this.pendingTerminalInputs = [];
        this.pendingTerminalHistory = "";
        this.terminalCwd = undefined;
        this.pendingTerminalCwd = undefined;
    }

    handleCommand(command: string, args?: unknown): void {
        switch (command) {
            case "focus":
                if (!this.terminal) return;
                this.fitTerminal();
                this.terminal.focus();
                break;
            case "setActive":
                this.terminalActive = args === true;
                console.log("setActive terminalActive", this.terminalActive);
                break;
            case "setTheme":
                if (!this.terminal) return;
                if (args && typeof args === "object") {
                    this.theme = {
                        ...this.theme,
                        ...args,
                    };
                    applyTerminalTheme(this.theme, this.terminal);
                }
                break;
            case "setClipboardOptions":
                if (args && typeof args === "object") {
                    this.clipboardOptions = {
                        ...this.clipboardOptions,
                        ...args,
                    };
                }
                break;
            case "setWebMCP":
                if (!args || typeof args !== "object") break;
                {
                    const options = args as Record<string, unknown>;
                    if (
                        typeof options.name !== "string" ||
                        typeof options.description !== "string"
                    ) {
                        break;
                    }
                    this.pendingWebMCP = {
                        name: options.name,
                        description: options.description,
                        readOnly: options.readOnly === true,
                    };
                    this.terminal?.setWebMCP(this.pendingWebMCP);
                }
                break;
            case "input":
                if (typeof args !== "string") break;
                if (this.terminalSocket?.connected && this.terminalReady) {
                    this.terminalSocket.emit("input", args);
                } else {
                    this.pendingTerminalInputs.push(args);
                }
                break;
            case "restoreHistory":
                if (typeof args !== "string") break;
                this.pendingTerminalHistory = args;
                if (this.terminal && this.terminalInitialized) {
                    this.terminal.write(this.pendingTerminalHistory);
                    this.pendingTerminalHistory = "";
                }
                break;
            case "copy":
                copyTerminalSelection(
                    this.terminal,
                    this.terminalContextMenuSelection,
                    this.events.onCopy,
                );
                break;
            case "paste":
                pasteFromClipboard(this.terminal);
                break;
            case "pasteText":
                if (typeof args === "string") {
                    this.terminal?.onData?.(args);
                }
                break;
            case "clear":
                this.terminal?.write("\u001b[2J\u001b[3J\u001b[H");
                break;
            default:
                console.log("unknown command", command);
        }
    }

    private initSocket(): void {
        const targetId = this.targetId;
        this.terminalSocket = createTerminalSocket(targetId, {
            onConnect: (socket, recovered) => {
                this.terminalReady = false;
                this.events.onStatus?.("connected");
                if (!this.terminal) {
                    this.createTerminal(socket, targetId);
                } else if (recovered) {
                    console.log(new Date(), socket.id, "socket recovered");
                } else {
                    console.log(new Date(), socket.id, "socket new connection");
                    this.fitTerminal();
                    this.terminal.write("\r\n");
                }

                if (this.outputBuffer) {
                    this.flushOutputBuffer();
                }
            },
            onDisconnect: (reason) => {
                console.log("disconnect", reason);
                this.terminalReady = false;
                this.pendingTerminalCwd = this.terminalCwd;
                this.events.onStatus?.("disconnected");
            },
            onConnectError: (error) => {
                console.log("connect_error", error);
                this.events.onStatus?.("disconnected");
            },
            onServerReady: (_option) => {
                this.terminalReady = true;
                for (const input of this.pendingTerminalInputs) {
                    this.terminalSocket?.emit("input", input);
                }
                this.pendingTerminalInputs = [];
                const cwdToRestore = this.pendingTerminalCwd;
                this.pendingTerminalCwd = undefined;
                if (cwdToRestore && this.terminalSocket?.connected) {
                    this.terminalSocket.emit(
                        "input",
                        `cd ${quoteShellPath(cwdToRestore)}\n`,
                    );
                }
                if (this.terminal) {
                    window.setTimeout(() => {
                        this.fitTerminal();
                        // fit() does not emit onResize when the dimensions did
                        // not change. The initial resize may also have happened
                        // before the server installed its resize listener, so
                        // always synchronize the current size after ready.
                        this.emitResize();
                    }, 0);
                }
            },
            onOutput: (data) => {
                if (!this.terminalInitialized || !this.terminal) {
                    this.outputBuffer += data;
                } else {
                    this.terminal.write(data);
                }
                this.events.onOutput?.(data);
            },
        });
    }

    private createTerminal(socket: Socket, targetId: number): void {
        if (this.terminalCreationPromise) return;
        if (!this.terminalContainer) return;

        this.terminalContainer.innerHTML = "";

        this.terminalCreationPromise = this.initializeTerminal(socket, targetId)
            .catch((error) => {
                if (!this.destroyed) {
                    console.error("failed to create terminal", error);
                }
            })
            .finally(() => {
                this.terminalCreationPromise = undefined;
            });
    }

    private async initializeTerminal(
        socket: Socket,
        targetId: number,
    ): Promise<void> {
        const container = this.terminalContainer;
        if (!container) return;

        const core = await GhosttyCore.load();
        if (this.destroyed || this.terminal) {
            core.dispose();
            return;
        }

        this.terminalInitialized = false;
        const terminal = new WTerm(container, {
            core,
            autoResize: true,
            webmcp: this.pendingWebMCP || {
                name: `ssh-terminal-${targetId}`,
                description: `Interactive SSH terminal for target ${targetId}`,
            },
            onWorkingDirectory: (uri) => {
                const cwd = parseTerminalCwd(uri);
                if (cwd) {
                    this.terminalCwd = cwd;
                    this.events.onCwd?.(cwd);
                }
            },
            onResize: (cols, rows) => {
                this.sizeCache = { col: cols, row: rows };
                if (this.terminalReady && socket.connected) {
                    socket.emit("resize", this.sizeCache);
                }
            },
            onData: (data) => {
                if (socket.connected) socket.emit("input", data);
            },
        });
        this.terminal = terminal;
        applyTerminalTheme(this.theme, terminal);

        this.clipboardCleanup = enhanceMouseCopyPaste(
            terminal,
            () => this.clipboardOptions,
            (selection) => {
                this.terminalContextMenuSelection = selection;
            },
            {
                onCopy: () => this.events.onCopy?.(),
                onInteraction: () => this.events.onInteraction?.(),
                onContextMenu: (data) => this.events.onContextMenu?.(data),
            },
        );

        try {
            await terminal.init();
        } catch (error) {
            if (!this.destroyed) throw error;
            return;
        }
        if (this.destroyed || this.terminal !== terminal) return;
        this.terminalInitialized = true;
        this.flushOutputBuffer();
        if (this.pendingTerminalHistory) {
            terminal.write(this.pendingTerminalHistory);
            this.pendingTerminalHistory = "";
        }
        terminal.focus();
    }

    private readonly fitTerminal = (): void => {
        if (!this.terminal || !this.terminalInitialized) return;
        console.log("fitTerminal terminalActive", this.terminalActive);
        this.terminal.fit();
    };

    private flushOutputBuffer(): void {
        if (!this.terminal || !this.terminalInitialized) return;
        if (this.outputBuffer) {
            this.terminal.write(this.outputBuffer);
            this.outputBuffer = "";
        }
    }

    private emitResize(): void {
        if (!this.terminalReady || !this.terminalSocket?.connected) return;

        const size =
            this.sizeCache ||
            (this.terminal
                ? { col: this.terminal.cols, row: this.terminal.rows }
                : undefined);
        if (size) this.terminalSocket.emit("resize", size);
    }
}
