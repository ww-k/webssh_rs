import { spawn, spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(import.meta.url), "../..");
const args = process.argv.slice(2);
const modeArgument = args.find((argument) => argument.startsWith("--mode="));
const mode = modeArgument?.slice("--mode=".length) || "desktop";

if (!new Set(["browser", "desktop"]).has(mode)) {
    console.error(`[dev] Unsupported mode: ${mode}. Use browser or desktop.`);
    process.exit(1);
}

const env = {
    ...process.env,
    FORCE_COLOR: "3", // 强制启用颜色
    COLOR: "1",
    NPM_CONFIG_COLOR: "always",
};
const isWin32 = process.platform === "win32";

// 确保安装依赖
try {
    lstatSync(resolve(projectRoot, "./src-client/node_modules"));
} catch (_err) {
    spawnSync("pnpm", ["install"], {
        cwd: resolve(projectRoot, "./src-client"),
        env,
    });
}

// 启动接口服务
const serverChild = spawn("cargo", ["run"], {
    cwd: resolve(projectRoot, "./src-server"),
    env,
});
processStdio("server", serverChild);

// 启动前端服务
const clientChild = spawn("npm", ["run", "dev"], {
    cwd: resolve(projectRoot, "./src-client"),
    env,
    shell: isWin32,
});
processStdio("client", clientChild);

const children = [serverChild, clientChild];

if (mode === "browser") {
    console.log("[dev] Browser mode. Open http://localhost:3000 in your browser.");
    serverChild.on("exit", shutdown);
    clientChild.on("exit", shutdown);
} else {
    // 启动桌面应用
    const tauriChild = spawn("tauri", ["dev"], {
        cwd: projectRoot,
        env,
        shell: isWin32,
    });
    processStdio("tauri", tauriChild);
    children.push(tauriChild);
    tauriChild.on("exit", shutdown);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

let isShuttingDown = false;

function shutdown(code) {
    if (isShuttingDown) {
        return;
    }
    isShuttingDown = true;
    for (const child of children) {
        if (!child.killed) {
            child.kill();
        }
    }
    process.exit(code ?? 0);
}

function processStdio(name, child) {
    child.stdout.on("data", (data) => {
        process.stdout.write(`[${name}]`);
        process.stdout.write(data); // 直接写入原始数据
    });
    child.stderr.on("data", (data) => {
        process.stdout.write(`[${name}]`);
        process.stderr.write(data); // 直接写入原始数据
    });
    child.on("exit", (code) => {
        console.log(`[${name}] process exited with code ${code}`);
    });
    child.on("error", (error) => {
        console.error(`[${name}] Failed`, error);
    });
    return child;
}
