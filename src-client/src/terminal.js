import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { io } from "socket.io-client";

import { parseTerminalCwd } from "./helpers/terminal_cwd";

import "@xterm/xterm/css/xterm.css";
import "./terminal.css";

var terminalContainer = document.getElementById("root");
var SSH_BASEPATH = location.origin;
/** @type {import('@xterm/xterm').Terminal} */
var term;
/** @type {import('@xterm/addon-fit').FitAddon} */
var fitAddon;
/** @type {import('@xterm/addon-clipboard').ClipboardAddon} */
var clipboardAddon;
var sizeCache;
var terminalActive = false;
var maxDisconnectionDuration = 5 * 60000;
var pendingTheme;
var terminalSocket;
var terminalReady = false;
var pendingTerminalInputs = [];

function postConnectionStatus(targetId, status) {
    window.parent.postMessage(
        {
            type: "webssh:terminal-status",
            targetId,
            status,
        },
        window.location.origin,
    );
}

const defaultTheme = {
    background: "#0f1115",
    foreground: "#f5f7fa",
    cursor: "#f5f7fa",
    selectionBackground: "#3a4352",
    scrollbarThumb: "rgba(255, 255, 255, 0.3)",
};

function init() {
    const preventDefault = (evt) => {
        evt.preventDefault();
        if (evt.dataTransfer) {
            evt.dataTransfer.dropEffect = "none";
        }
    };

    document.body.addEventListener("dragover", preventDefault, false);
    document.body.addEventListener("drop", preventDefault, false);
    window.addEventListener("message", receiveMessage, false);

    initTerm();
}

function receiveMessage(event) {
    if (event.origin !== window.location.origin) return;

    var data = event.data;
    if (!data || typeof data.command !== "string") return;

    switch (data.command) {
        case "focus":
            if (term) {
                fitTerminal();
                term.focus();
            }
            break;
        case "setActive":
            terminalActive = data.args === true;
            console.log("setActive terminalActive", terminalActive);
            break;
        case "setTheme":
            if (data.args && typeof data.args === "object") {
                pendingTheme = {
                    ...(term?.options.theme || defaultTheme),
                    ...data.args,
                };
                applyTerminalTheme(pendingTheme);
            }
            break;
        case "input":
            if (typeof data.args !== "string") break;
            if (terminalSocket?.connected && terminalReady) {
                terminalSocket.emit("input", data.args);
            } else {
                pendingTerminalInputs.push(data.args);
            }
            break;
        default:
            console.log("unknown command", data);
            break;
    }
}

function applyTerminalTheme(theme) {
    document.documentElement.style.setProperty(
        "--terminal-background",
        theme.background || defaultTheme.background,
    );
    document.documentElement.style.setProperty(
        "--terminal-scrollbar-thumb",
        theme.scrollbarThumb || defaultTheme.scrollbarThumb,
    );
    if (term) {
        term.options.theme = theme;
    }
}

function initTerm() {
    var queryParams = decodeQueryParam(location.search);
    var query = {};
    if (queryParams.target_id) {
        query.target_id = queryParams.target_id;
    } else {
        return console.error("initTerm missing params. target_id.");
    }

    /** @type {import('socket.io-client').io} */
    var ioLookup = io;
    /** @type {import('socket.io-client').Socket} */
    var socket = ioLookup(SSH_BASEPATH, {
        path: "/api/ssh/terminal/socket.io",
        query: query,
        transports:
            "WebSocket" in window ? ["websocket"] : ["polling", "websocket"],
    });
    terminalSocket = socket;
    var buf = "";

    socket.on("connect", () => {
        terminalReady = false;
        postConnectionStatus(Number.parseInt(query.target_id, 10), "connected");
        if (!term) {
            createTerminal(socket, Number.parseInt(query.target_id, 10));
        } else {
            if (socket.recovered) {
                console.log(new Date(), socket.id, "socket recovered");
            } else {
                console.log(new Date(), socket.id, "socket new connection");

                fitTerminal();
                term.writeln("");
            }
        }

        if (buf && buf !== "") {
            term.write(buf);
            buf = "";
        }
    });

    socket.on("disconnect", (reason) => {
        console.log("disconnect", reason);
        terminalReady = false;
        postConnectionStatus(
            Number.parseInt(query.target_id, 10),
            "disconnected",
        );
    });

    socket.on("connect_error", (error) => {
        console.log("connect_error", error);
        postConnectionStatus(
            Number.parseInt(query.target_id, 10),
            "disconnected",
        );
    });

    socket.on("server_ready", (option) => {
        terminalReady = true;
        for (const input of pendingTerminalInputs) {
            socket.emit("input", input);
        }
        pendingTerminalInputs = [];
        if (typeof option.maxDisconnectionDuration === "number") {
            maxDisconnectionDuration = option.maxDisconnectionDuration;
        }

        if (!term) {
            return;
        }

        setTimeout(() => {
            fitTerminal();
        }, 0);
    });

    socket.on("output", (data) => {
        if (!term) {
            buf += data;
            return;
        }

        term.write(data);
    });
}

/**
 * @param {import('socket.io-client').Socket} socket
 * @returns
 */
function createTerminal(socket, targetId) {
    terminalContainer.innerHTML = "";

    term = new Terminal({ theme: pendingTheme || defaultTheme });
    fitAddon = new FitAddon();
    clipboardAddon = new ClipboardAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(clipboardAddon);
    term.parser.registerOscHandler(7, (payload) => {
        console.log(`OSC 7: ${payload}`);
        const cwd = parseTerminalCwd(payload);
        if (cwd) {
            window.parent.postMessage(
                {
                    type: "webssh:terminal-cwd",
                    targetId,
                    cwd,
                },
                window.location.origin,
            );
        }
        return true;
    });

    term.open(terminalContainer);
    applyTerminalTheme(term.options.theme);

    term.onResize((size) => {
        if (!sizeCache) {
            sizeCache = { col: size.cols, row: size.rows };
        } else {
            sizeCache.col = size.cols;
            sizeCache.row = size.rows;
        }
        if (socket.connected) {
            socket.emit("resize", sizeCache);
        }
    });

    term.onData((data) => {
        if (socket.connected) {
            socket.emit("input", data);
        }
    });

    enhanceMouseCopyPaste(term, targetId);
    manuallyRetryPlugin.apply(socket, term);

    term.focus();

    window.addEventListener("resize", () => {
        fitTerminal();
    });

    return term;
}

function fitTerminal() {
    if (!term) return;
    console.log("fitTerminal terminalActive", terminalActive);
    fitAddon.fit();
}

function decodeQueryParam(searchStr) {
    var str = searchStr.indexOf("?") === -1 ? searchStr : searchStr.substr(1);
    var arr = str === "" ? [] : str.split("&");
    var param = {};

    arr.forEach((val) => {
        var itemArr = val.split("=");
        param[itemArr[0]] = decodeURIComponent(itemArr[1]);
    });

    return param;
}

/** @type {import('@xterm/xterm').ITheme} */
const defaultOption = {
    background: "#000000",
    foreground: "#ffffff",
    fontSize: 15,
    fontFamily: "",
};

/**
 * @param {string} configPath
 * @returns {import('@xterm/xterm').ITheme}
 */
function _getConfig(configPath) {
    if (!configPath) {
        return defaultOption;
    }
    return defaultOption;
}

var manuallyRetryPlugin = {
    manuallyRetry: false,
    manuallyRetryTimtoutTimer: null,
    /**
     * 手动重试策略：
     * 1，用户输入时，如果已经断开连接，尝试手动重新连接，并增加超时检测。
     * 2，如果连接成功，则手动重试成功。
     * 3，如果连接失败，则会进入socket.io的重试策略。
     * 4，如果连接超时，则手动重试失败。
     * @param {import('socket.io-client').Socket} socket
     * @param {import('xterm').Terminal} term
     */
    apply(socket, term) {
        socket.on("connect", () => {
            manuallyRetryPlugin.resetState();
        });

        socket.on("disconnect", (reason) => {
            console.log("disconnect", reason);

            manuallyRetryPlugin.manuallyRetry = false;
        });

        socket.on("connect_error", (err) => {
            console.log("connect_error", err);

            manuallyRetryPlugin.manuallyRetry = false;
        });

        term.onData(() => {
            if (socket.disconnected && !manuallyRetryPlugin.manuallyRetry) {
                manuallyRetryPlugin.manuallyRetry = true;
                socket.connect();
                manuallyRetryPlugin.detectTimeout(socket);
            }
        });
    },

    /**
     * @param {import('socket.io-client').Socket} socket
     */
    detectTimeout(socket) {
        clearTimeout(manuallyRetryPlugin.manuallyRetryTimtoutTimer);
        manuallyRetryPlugin.manuallyRetryTimtoutTimer = setTimeout(() => {
            manuallyRetryPlugin.resetState();
            if (!socket.connected) {
                term.writeln("");
                term.writeln("reconnect timeout");
                term.writeln("");
            }
        }, maxDisconnectionDuration);
    },

    resetState() {
        manuallyRetryPlugin.manuallyRetry = false;
        clearTimeout(manuallyRetryPlugin.manuallyRetryTimtoutTimer);
    },
};

/**
 * 增强鼠标复制粘贴功能
 * - 实现自动复制选中文本
 * - 实现鼠标中键和右键粘贴当前terminal中选中的文本
 * @param {import('@xterm/xterm').Terminal} term
 * @param {number} targetId
 */
function enhanceMouseCopyPaste(term, targetId) {
    term.onSelectionChange((_evt) => {
        const text = term.getSelection() || "";
        console.log(`selection and copy: ${text}`);
        if (text !== "") {
            navigator.clipboard.writeText(text).then(() => {
                window.parent.postMessage(
                    {
                        type: "webssh:terminal-copy",
                        targetId,
                    },
                    window.location.origin,
                );
            });
        }
    });

    document.addEventListener("pointerdown", (evt) => {
        if (evt.button === 1 || evt.button === 2) {
            navigator.clipboard.readText().then((text) => {
                console.log(`paste: ${text}`);
                term.paste(text);
            });
        }
    });
}

init();
