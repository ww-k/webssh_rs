import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { io } from "socket.io-client";

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
var maxDisconnectionDuration = 5 * 60000;

function init() {
    const preventDefault = (evt) => {
        evt.preventDefault();
        if (evt.dataTransfer) {
            evt.dataTransfer.dropEffect = "none";
        }
    };

    document.body.addEventListener("dragover", preventDefault, false);
    document.body.addEventListener("drop", preventDefault, false);

    initTerm();
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
    var buf = "";

    socket.on("connect", () => {
        if (!term) {
            createTerminal(socket);
        } else {
            if (socket.recovered) {
                console.log(new Date(), socket.id, "socket recovered");
            } else {
                console.log(new Date(), socket.id, "socket new connection");

                fitAddon.fit();
                socket.emit("resize", sizeCache);
                term.writeln("");
            }
        }

        if (buf && buf !== "") {
            term.write(buf);
            buf = "";
        }
    });

    socket.on("server_ready", (option) => {
        if (typeof option.maxDisconnectionDuration === "number") {
            maxDisconnectionDuration = option.maxDisconnectionDuration;
        }

        if (!term) {
            return;
        }

        setTimeout(() => {
            fitAddon.fit();
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
function createTerminal(socket) {
    terminalContainer.innerHTML = "";

    term = new Terminal();
    fitAddon = new FitAddon();
    clipboardAddon = new ClipboardAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(clipboardAddon);

    term.open(terminalContainer);

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

    enhanceMouseCopyPaste(term);
    manuallyRetryPlugin.apply(socket, term);

    term.focus();

    window.addEventListener("resize", () => {
        fitAddon.fit();
    });

    window.addEventListener(
        "message",
        function receiveMessage(event) {
            var data = event.data;

            if (typeof term !== "object") return;
            switch (data.command) {
                case "focus":
                    fitAddon.fit();
                    term.focus();
                    break;
                case "setTheme":
                    term.options.theme = {
                        ...term.options.theme,
                        ...data.args,
                    };
                    break;
                default:
                    console.log("unknown command", data);
                    break;
            }
        },
        false,
    );

    return term;
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
    var config;
    try {
        config = JSON.parse(localStorage.getItem(configPath));
        return config;
    } catch (error) {
        console.warn(error);
        return defaultOption;
    }
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
 */
function enhanceMouseCopyPaste(term) {
    term.onSelectionChange((_evt) => {
        const text = term.getSelection() || "";
        console.log(`selection and copy: ${text}`);
        if (text !== "") {
            navigator.clipboard.writeText(text);
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
