import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

import { parseTerminalCwd } from "@/helpers/terminal_cwd";

import type { Socket } from "socket.io-client";

import {
    copyTerminalSelection,
    enhanceMouseCopyPaste,
    pasteFromClipboard,
} from "./clipboard";
import {
    defaultClipboardOptions,
    defaultMaxDisconnectionDuration,
    defaultTheme,
} from "./constants";
import { postConnectionStatus, postTerminalMessage } from "./messages";
import { targetIdFromQuery } from "./query";
import { installManualRetry } from "./reconnect";
import { createTerminalSocket } from "./socket";
import { applyTerminalTheme } from "./theme";

import type { ClipboardOptions, TerminalSize, TerminalTheme } from "./types";

interface TerminalMessage {
    command?: unknown;
    args?: unknown;
}

class TerminalController {
    private readonly terminalContainer = document.getElementById("root");
    private terminal?: Terminal;
    private fitAddon?: FitAddon;
    private clipboardAddon?: ClipboardAddon;
    private sizeCache?: TerminalSize;
    private terminalActive = false;
    private maxDisconnectionDuration = defaultMaxDisconnectionDuration;
    private pendingTheme?: TerminalTheme;
    private terminalSocket?: Socket;
    private terminalReady = false;
    private pendingTerminalInputs: string[] = [];
    private pendingTerminalHistory = "";
    private terminalContextMenuSelection = "";
    private clipboardOptions: ClipboardOptions = {
        ...defaultClipboardOptions,
    };
    private outputBuffer = "";

    init(): void {
        const preventDefault = (event: DragEvent) => {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
        };

        document.body.addEventListener("dragover", preventDefault, false);
        document.body.addEventListener("drop", preventDefault, false);
        window.addEventListener("message", this.receiveMessage);

        this.initSocket();
    }

    private readonly receiveMessage = (event: MessageEvent): void => {
        if (event.origin !== window.location.origin) return;

        const data = event.data as TerminalMessage;
        if (!data || typeof data.command !== "string") return;

        switch (data.command) {
            case "focus":
                if (this.terminal) {
                    this.fitTerminal();
                    this.terminal.focus();
                }
                break;
            case "setActive":
                this.terminalActive = data.args === true;
                console.log("setActive terminalActive", this.terminalActive);
                break;
            case "setTheme":
                if (data.args && typeof data.args === "object") {
                    this.pendingTheme = {
                        ...(this.terminal?.options.theme || defaultTheme),
                        ...data.args,
                    };
                    applyTerminalTheme(this.pendingTheme, this.terminal);
                }
                break;
            case "setClipboardOptions":
                if (data.args && typeof data.args === "object") {
                    this.clipboardOptions = {
                        ...this.clipboardOptions,
                        ...data.args,
                    };
                }
                break;
            case "input":
                if (typeof data.args !== "string") break;
                if (this.terminalSocket?.connected && this.terminalReady) {
                    this.terminalSocket.emit("input", data.args);
                } else {
                    this.pendingTerminalInputs.push(data.args);
                }
                break;
            case "restoreHistory":
                if (typeof data.args !== "string") break;
                this.pendingTerminalHistory = data.args;
                if (this.terminal) {
                    this.terminal.write(this.pendingTerminalHistory);
                    this.pendingTerminalHistory = "";
                }
                break;
            case "copy":
                copyTerminalSelection(
                    this.terminal,
                    this.getTargetId(),
                    this.terminalContextMenuSelection,
                );
                break;
            case "paste":
                pasteFromClipboard(this.terminal);
                break;
            case "pasteText":
                if (typeof data.args === "string") {
                    this.terminal?.paste(data.args);
                }
                break;
            case "clear":
                this.terminal?.clear();
                break;
            default:
                console.log("unknown command", data);
        }
    };

    private initSocket(): void {
        const targetId = targetIdFromQuery();
        if (targetId === undefined) {
            console.error("initTerm missing params. target_id.");
            return;
        }

        this.terminalSocket = createTerminalSocket(targetId, {
            onConnect: (socket, recovered) => {
                this.terminalReady = false;
                postConnectionStatus(targetId, "connected");
                if (!this.terminal) {
                    this.createTerminal(socket, targetId);
                } else if (recovered) {
                    console.log(new Date(), socket.id, "socket recovered");
                } else {
                    console.log(new Date(), socket.id, "socket new connection");
                    this.fitTerminal();
                    this.terminal.writeln("");
                }

                if (this.outputBuffer) {
                    this.terminal?.write(this.outputBuffer);
                    this.outputBuffer = "";
                }
            },
            onDisconnect: (reason) => {
                console.log("disconnect", reason);
                this.terminalReady = false;
                postConnectionStatus(targetId, "disconnected");
            },
            onConnectError: (error) => {
                console.log("connect_error", error);
                postConnectionStatus(targetId, "disconnected");
            },
            onServerReady: (option) => {
                this.terminalReady = true;
                for (const input of this.pendingTerminalInputs) {
                    this.terminalSocket?.emit("input", input);
                }
                this.pendingTerminalInputs = [];
                if (typeof option.maxDisconnectionDuration === "number") {
                    this.maxDisconnectionDuration =
                        option.maxDisconnectionDuration;
                }
                if (this.terminal)
                    window.setTimeout(() => this.fitTerminal(), 0);
            },
            onOutput: (data) => {
                if (!this.terminal) this.outputBuffer += data;
                else this.terminal.write(data);
                postTerminalMessage({
                    type: "webssh:terminal-output",
                    targetId,
                    data,
                });
            },
        });
    }

    private createTerminal(socket: Socket, targetId: number): void {
        if (!this.terminalContainer) return;
        this.terminalContainer.innerHTML = "";

        this.terminal = new Terminal({
            theme: this.pendingTheme || defaultTheme,
        });
        this.fitAddon = new FitAddon();
        this.clipboardAddon = new ClipboardAddon();
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(this.clipboardAddon);
        this.terminal.parser.registerOscHandler(7, (payload) => {
            const cwd = parseTerminalCwd(payload);
            if (cwd) {
                postTerminalMessage({
                    type: "webssh:terminal-cwd",
                    targetId,
                    cwd,
                });
            }
            return true;
        });

        this.terminal.open(this.terminalContainer);
        applyTerminalTheme(
            this.terminal.options.theme || defaultTheme,
            this.terminal,
        );
        if (this.pendingTerminalHistory) {
            this.terminal.write(this.pendingTerminalHistory);
            this.pendingTerminalHistory = "";
        }

        this.terminal.onResize((size) => {
            this.sizeCache = { col: size.cols, row: size.rows };
            if (socket.connected) socket.emit("resize", this.sizeCache);
        });
        this.terminal.onData((data) => {
            if (socket.connected) socket.emit("input", data);
        });

        enhanceMouseCopyPaste(
            this.terminal,
            targetId,
            () => this.clipboardOptions,
            (selection) => {
                this.terminalContextMenuSelection = selection;
            },
        );
        installManualRetry(
            socket,
            this.terminal,
            () => this.maxDisconnectionDuration,
        );

        this.terminal.focus();
        window.addEventListener("resize", this.fitTerminal);
    }

    private readonly fitTerminal = (): void => {
        if (!this.terminal || !this.fitAddon) return;
        console.log("fitTerminal terminalActive", this.terminalActive);
        this.fitAddon.fit();
    };

    private getTargetId(): number {
        return targetIdFromQuery() ?? 0;
    }
}

export function initTerminal(): void {
    new TerminalController().init();
}
