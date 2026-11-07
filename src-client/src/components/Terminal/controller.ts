import { WTerm, type WebMCPOptions } from "@wterm/dom";

import { parseTerminalCwd } from "@/helpers/terminal_cwd";

import {
    copyTerminalSelection,
    enhanceMouseCopyPaste,
    pasteFromClipboard,
} from "./clipboard";
import { defaultClipboardOptions, defaultTheme } from "./constants";
import { postConnectionStatus, postTerminalMessage } from "./messages";
import { targetIdFromQuery } from "./query";
import { createTerminalSocket } from "./socket";
import { applyTerminalTheme } from "./theme";

import type { Socket } from "socket.io-client";
import type { ClipboardOptions, TerminalSize, TerminalTheme } from "./types";

interface TerminalMessage {
    command?: unknown;
    args?: unknown;
}

class TerminalController {
    private readonly terminalContainer = document.getElementById("root");
    private terminal?: WTerm;
    private terminalInitialized = false;
    private sizeCache?: TerminalSize;
    private terminalActive = false;
    private pendingTheme?: TerminalTheme;
    private terminalSocket?: Socket;
    private terminalReady = false;
    private pendingTerminalInputs: string[] = [];
    private pendingTerminalHistory = "";
    private terminalContextMenuSelection = "";
    private pendingWebMCP?: WebMCPOptions;
    private clipboardOptions: ClipboardOptions = {
        ...defaultClipboardOptions,
    };
    private outputBuffer = "";
    private terminalCwdOutputBuffer = "";

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
                        ...(this.pendingTheme || defaultTheme),
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
            case "setWebMCP":
                if (!data.args || typeof data.args !== "object") break;
                {
                    const options = data.args as Record<string, unknown>;
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
                if (this.terminal && this.terminalInitialized) {
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
                    this.terminal?.onData?.(data.args);
                }
                break;
            case "clear":
                this.terminal?.write("\u001b[2J\u001b[3J\u001b[H");
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
                    this.terminal.write("\r\n");
                }

                if (this.outputBuffer) {
                    this.flushOutputBuffer();
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
            onServerReady: (_option) => {
                this.terminalReady = true;
                for (const input of this.pendingTerminalInputs) {
                    this.terminalSocket?.emit("input", input);
                }
                this.pendingTerminalInputs = [];
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
                this.handleTerminalOutput(data, targetId);
                if (!this.terminalInitialized || !this.terminal) {
                    this.outputBuffer += data;
                } else {
                    this.terminal.write(data);
                }
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

        this.terminalInitialized = false;
        this.terminal = new WTerm(this.terminalContainer, {
            autoResize: true,
            webmcp: this.pendingWebMCP || {
                name: `ssh-terminal-${targetId}`,
                description: `Interactive SSH terminal for target ${targetId}`,
            },
            onWorkingDirectory: (uri) => {
                const cwd = parseTerminalCwd(uri);
                if (cwd) {
                    postTerminalMessage({
                        type: "webssh:terminal-cwd",
                        targetId,
                        cwd,
                    });
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
        const terminal = this.terminal;
        applyTerminalTheme(this.pendingTheme || defaultTheme, terminal);

        enhanceMouseCopyPaste(
            terminal,
            targetId,
            () => this.clipboardOptions,
            (selection) => {
                this.terminalContextMenuSelection = selection;
            },
        );

        void this.terminal
            .init()
            .then(() => {
                if (this.terminal !== terminal) return;
                this.terminalInitialized = true;
                this.flushOutputBuffer();
                if (this.pendingTerminalHistory) {
                    terminal.write(this.pendingTerminalHistory);
                    this.pendingTerminalHistory = "";
                }
                terminal.focus();
            })
            .catch((error) => {
                console.error("failed to initialize terminal", error);
            });
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

    /**
     * The bundled wterm core does not expose OSC 7 through getWorkingDirectory.
     * Keep this parser at the transport boundary so OSC 7 still works and can
     * be split across Socket.IO output packets without changing terminal data.
     */
    private handleTerminalOutput(data: string, targetId: number): void {
        const output = this.terminalCwdOutputBuffer + data;
        this.terminalCwdOutputBuffer = "";
        let offset = 0;

        while (offset < output.length) {
            const start = output.indexOf("\u001b]7;", offset);
            if (start < 0) {
                this.terminalCwdOutputBuffer = this.partialOsc7Prefix(output);
                return;
            }

            const payloadStart = start + 4;
            const bell = output.indexOf("\u0007", payloadStart);
            const stringTerminator = output.indexOf("\u001b\\", payloadStart);
            let end = bell;
            let terminatorLength = 1;
            if (end < 0 || (stringTerminator >= 0 && stringTerminator < end)) {
                end = stringTerminator;
                terminatorLength = 2;
            }
            if (end < 0) {
                this.terminalCwdOutputBuffer = output.slice(start);
                return;
            }

            const cwd = parseTerminalCwd(output.slice(payloadStart, end));
            if (cwd) {
                postTerminalMessage({
                    type: "webssh:terminal-cwd",
                    targetId,
                    cwd,
                });
            }
            offset = end + terminatorLength;
        }
    }

    private partialOsc7Prefix(value: string): string {
        const prefix = "\u001b]7;";
        for (
            let length = Math.min(prefix.length - 1, value.length);
            length > 0;
            length -= 1
        ) {
            const suffix = value.slice(-length);
            if (prefix.startsWith(suffix)) return suffix;
        }
        return "";
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

    private getTargetId(): number {
        return targetIdFromQuery() ?? 0;
    }
}

export function initTerminal(): void {
    new TerminalController().init();
}
