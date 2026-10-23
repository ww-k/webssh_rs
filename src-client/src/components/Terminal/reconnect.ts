import type { Terminal } from "@xterm/xterm";
import type { Socket } from "socket.io-client";

export function installManualRetry(
    socket: Socket,
    terminal: Terminal,
    getMaxDisconnectionDuration: () => number,
): void {
    let manuallyRetry = false;
    let timeout: number | undefined;

    const resetState = () => {
        manuallyRetry = false;
        if (timeout !== undefined) window.clearTimeout(timeout);
        timeout = undefined;
    };

    const detectTimeout = () => {
        if (timeout !== undefined) window.clearTimeout(timeout);
        timeout = window.setTimeout(() => {
            resetState();
            if (!socket.connected) {
                terminal.writeln("");
                terminal.writeln("reconnect timeout");
                terminal.writeln("");
            }
        }, getMaxDisconnectionDuration());
    };

    socket.on("connect", resetState);
    socket.on("disconnect", (reason) => {
        console.log("disconnect", reason);
        manuallyRetry = false;
    });
    socket.on("connect_error", (error) => {
        console.log("connect_error", error);
        manuallyRetry = false;
    });

    terminal.onData(() => {
        if (socket.disconnected && !manuallyRetry) {
            manuallyRetry = true;
            socket.connect();
            detectTimeout();
        }
    });
}
