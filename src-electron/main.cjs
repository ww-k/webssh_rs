const {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    shell,
} = require("electron");
const { spawn } = require("node:child_process");
const {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} = require("node:fs");
const { join, resolve } = require("node:path");
const { URL } = require("node:url");

app.disableHardwareAcceleration();

const DEFAULT_SERVER_PORT = 10086;
const SERVER_PORT_CONFIG_FILE = "server-port";
const SERVER_START_TIMEOUT_MS = 120_000;
const PROJECT_ROOT = resolve(__dirname, "..");

let mainWindow;
let serverProcess;
let serverPort = null;
let isQuitting = false;

app.on("ready", () => {
    const singleInstanceLock = app.requestSingleInstanceLock();
    if (!singleInstanceLock) {
        app.quit();
        return;
    }
    app.on("second-instance", () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    });
    startApplication().catch((error) => {
        console.error("Failed to start Electron application", error);
        dialog.showErrorBox("Shrug failed to start", error.message);
        app.quit();
    });
});

ipcMain.handle("server-port:get", () => readConfiguredServerPort());
ipcMain.handle("server-port:set", (_event, port) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("server port must be between 1 and 65535");
    }
    const configPath = getServerPortConfigPath();
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(configPath, String(port), "utf8");
});

async function startApplication() {
    migrateLegacyData();
    if (process.env.WEBSSH_RS_EXTERNAL_SERVER !== "true") {
        serverPort = await startServer();
    } else {
        serverPort = parsePort(process.env.WEBSSH_RS_SERVER_PORT) || DEFAULT_SERVER_PORT;
    }

    const devUrl = process.env.WEBSSH_RS_DEV_URL;
    const appUrl = devUrl || `http://127.0.0.1:${serverPort}/`;
    mainWindow = createWindow();
    await waitForUrl(appUrl);
    await mainWindow.loadURL(appUrl);
    configureAutoUpdate();
}

function createWindow() {
    const window = new BrowserWindow({
        title: "Shrug",
        width: 800,
        height: 600,
        resizable: true,
        fullscreen: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: join(__dirname, "preload.cjs"),
        },
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
        openExternalUrl(url);
        return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
        if (!isAllowedAppUrl(url)) {
            event.preventDefault();
            openExternalUrl(url);
        }
    });
    window.on("closed", () => {
        mainWindow = null;
    });
    return window;
}

async function startServer() {
    const configuredPort = readConfiguredServerPort();
    const env = {
        ...process.env,
        WEBSSH_RS_DB_PATH: join(app.getPath("userData"), "db.sqlite"),
        WEBSSH_RS_SERVER_PORT: String(configuredPort),
    };
    const command = getServerCommand();
    console.log(`[electron] Starting server: ${command.file} ${command.args.join(" ")}`);
    serverProcess = spawn(command.file, command.args, {
        cwd: command.cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });

    let output = "";
    return new Promise((resolvePort, reject) => {
        const timeout = setTimeout(() => {
            finish(new Error("timed out waiting for the server to start"));
        }, SERVER_START_TIMEOUT_MS);
        let settled = false;

        const onOutput = (chunk) => {
            const text = chunk.toString();
            process.stdout.write(`[server] ${text}`);
            output = `${output}${text}`.slice(-8192);
            const match = output.match(
                /Listening on http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})/i,
            );
            const port = match ? parsePort(match[1]) : null;
            if (port) finish(null, port);
        };
        const onExit = (code, signal) => {
            finish(
                new Error(
                    `server exited before reporting its port (code=${code}, signal=${signal})`,
                ),
            );
        };
        const onError = (error) => finish(error);

        serverProcess.stdout.on("data", onOutput);
        serverProcess.stderr.on("data", onOutput);
        serverProcess.once("exit", onExit);
        serverProcess.once("error", onError);

        function finish(error, port) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            serverProcess.stdout.off("data", onOutput);
            serverProcess.stderr.off("data", onOutput);
            serverProcess.off("exit", onExit);
            serverProcess.off("error", onError);
            if (error) {
                reject(error);
            } else {
                resolvePort(port);
            }
        }
    });
}

function getServerCommand() {
    const configuredBinary = process.env.WEBSSH_RS_SERVER_BINARY;
    if (configuredBinary) {
        return { file: configuredBinary, args: [], cwd: PROJECT_ROOT };
    }
    if (!app.isPackaged) {
        return {
            file: process.platform === "win32" ? "cargo.exe" : "cargo",
            args: ["run", "--manifest-path", join(PROJECT_ROOT, "src-server", "Cargo.toml")],
            cwd: PROJECT_ROOT,
        };
    }
    const binaryName = process.platform === "win32" ? "webssh_rs_server.exe" : "webssh_rs_server";
    return {
        file: join(process.resourcesPath, "server", binaryName),
        args: [],
        cwd: process.resourcesPath,
    };
}

async function waitForUrl(url) {
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url === process.env.WEBSSH_RS_DEV_URL ? url : `${url}api/health`);
            if (response.ok) return;
        } catch (_error) {
            // The server or Rsbuild process may still be starting.
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error(`timed out waiting for ${url}`);
}

function configureAutoUpdate() {
    if (!app.isPackaged || process.env.WEBSSH_RS_DISABLE_AUTO_UPDATE === "true") return;
    try {
        const { autoUpdater } = require("electron-updater");
        autoUpdater.autoDownload = false;
        autoUpdater.on("error", (error) => console.error("Auto update failed", error));
        autoUpdater.on("update-available", async () => {
            try {
                await autoUpdater.downloadUpdate();
            } catch (error) {
                console.error("Auto update download failed", error);
            }
        });
        autoUpdater.on("update-downloaded", () => {
            autoUpdater.quitAndInstall(false, true);
        });
        void autoUpdater.checkForUpdates();
    } catch (error) {
        console.error("Auto update is unavailable", error);
    }
}

function migrateLegacyData() {
    const targetDir = app.getPath("userData");
    mkdirSync(targetDir, { recursive: true });
    const legacyDir = join(app.getPath("appData"), "io.github.ww-k.webssh-rs");
    if (!existsSync(legacyDir) || resolve(legacyDir) === resolve(targetDir)) return;
    for (const fileName of ["db.sqlite", SERVER_PORT_CONFIG_FILE]) {
        const source = join(legacyDir, fileName);
        const target = join(targetDir, fileName);
        if (existsSync(source) && !existsSync(target)) copyFileSync(source, target);
    }
}

function readConfiguredServerPort() {
    try {
        const value = readFileSync(getServerPortConfigPath(), "utf8").trim();
        return parsePort(value) || DEFAULT_SERVER_PORT;
    } catch (_error) {
        return parsePort(process.env.WEBSSH_RS_SERVER_PORT) || DEFAULT_SERVER_PORT;
    }
}

function getServerPortConfigPath() {
    return join(app.getPath("userData"), SERVER_PORT_CONFIG_FILE);
}

function parsePort(value) {
    const port = Number.parseInt(value || "", 10);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function isAllowedAppUrl(url) {
    try {
        const parsed = new URL(url);
        return (
            (parsed.protocol === "http:" || parsed.protocol === "https:") &&
            (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
        );
    } catch (_error) {
        return false;
    }
}

function openExternalUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") {
            void shell.openExternal(url);
        }
    } catch (_error) {
        // Ignore malformed external URLs.
    }
}

async function stopServer() {
    if (!serverProcess || serverProcess.exitCode !== null) return;
    const processToStop = serverProcess;
    serverProcess = null;
    if (process.platform === "win32" && processToStop.pid) {
        const killer = spawn("taskkill", ["/pid", String(processToStop.pid), "/t", "/f"], {
            windowsHide: true,
            stdio: "ignore",
        });
        await new Promise((resolveStop) => killer.once("exit", resolveStop));
    } else {
        processToStop.kill("SIGTERM");
    }
}

app.on("before-quit", (event) => {
    if (isQuitting) return;
    isQuitting = true;
    if (serverProcess) {
        event.preventDefault();
        void stopServer().finally(() => app.quit());
    }
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
