import { io, type Socket } from "socket.io-client";

import type { ServerReadyOption, TerminalSocketCallbacks } from "./types";

function parseServerReadyOption(option: unknown): ServerReadyOption {
    if (!option || typeof option !== "object") return {};
    const value = option as { maxDisconnectionDuration?: unknown };
    return typeof value.maxDisconnectionDuration === "number"
        ? { maxDisconnectionDuration: value.maxDisconnectionDuration }
        : {};
}

export function createTerminalSocket(
    targetId: number,
    callbacks: TerminalSocketCallbacks,
): Socket {
    const socket = io(window.location.origin, {
        path: "/api/ssh/terminal/socket.io",
        query: { target_id: String(targetId) },
        transports:
            "WebSocket" in window ? ["websocket"] : ["polling", "websocket"],
    });

    socket.on("connect", () => {
        callbacks.onConnect(socket, socket.recovered === true);
    });
    socket.on("disconnect", (reason) => {
        callbacks.onDisconnect(reason);
    });
    socket.on("connect_error", (error: Error) => {
        callbacks.onConnectError(error);
    });
    socket.on("server_ready", (option: unknown) => {
        callbacks.onServerReady(parseServerReadyOption(option));
    });
    socket.on("output", (data: unknown) => {
        if (typeof data === "string") callbacks.onOutput(data);
    });

    return socket;
}
