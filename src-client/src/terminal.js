import "@wterm/dom/css";
import "./terminal.css";

import { TerminalController } from "./components/Terminal/controller";

function targetIdFromQuery(search = window.location.search) {
    const rawTargetId = new URLSearchParams(search).get("target_id");
    if (!rawTargetId) return undefined;

    const parsedTargetId = Number.parseInt(rawTargetId, 10);
    return Number.isNaN(parsedTargetId) ? undefined : parsedTargetId;
}

const targetId = targetIdFromQuery();
if (targetId !== undefined) {
    console.error("initTerm missing params. target_id.");
} else {
    const controller = new TerminalController(
        "root",
        targetId,
        {
            onStatus: (status) =>
                window.parent.postMessage(
                    {
                        type: "webssh:terminal-status",
                        targetId,
                        status,
                    },
                    window.location.origin,
                ),
            onOutput: (data) =>
                window.parent.postMessage(
                    {
                        type: "webssh:terminal-output",
                        targetId,
                        data,
                    },
                    window.location.origin,
                ),
            onCwd: (cwd) =>
                window.parent.postMessage(
                    {
                        type: "webssh:terminal-cwd",
                        targetId,
                        cwd,
                    },
                    window.location.origin,
                ),
            onCopy: () =>
                window.parent.postMessage(
                    { type: "webssh:terminal-copy", targetId },
                    window.location.origin,
                ),
            onInteraction: () =>
                window.parent.postMessage(
                    { type: "webssh:terminal-interaction", targetId },
                    window.location.origin,
                ),
            onContextMenu: (data) =>
                window.parent.postMessage(
                    {
                        type: "webssh:terminal-contextmenu",
                        targetId,
                        ...data,
                    },
                    window.location.origin,
                ),
        },
        undefined,
        { preventDocumentDrop: true },
    );

    window.addEventListener("message", (event) => {
        if (
            event.origin !== window.location.origin ||
            event.source !== window.parent
        ) {
            return;
        }

        const data = event.data;
        if (!data || typeof data.command !== "string") return;
        if (data.targetId !== undefined && data.targetId !== targetId) {
            return;
        }
        controller.handleCommand(data.command, data.args);
    });

    controller.init();
}
