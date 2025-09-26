import { spawn, spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(import.meta.url), "../..");

const env = {
    ...process.env,
    FORCE_COLOR: "3", // 强制启用颜色
    COLOR: "1",
    NPM_CONFIG_COLOR: "always",
};
const isWin32 = process.platform === "win32";

// 确保安装依赖
try {
    lstatSync(resolve(projectRoot, "./client/node_modules"));
} catch (_err) {
    spawnSync("pnpm", ["install"], {
        cwd: resolve(projectRoot, "./client"),
        env,
    });
}

// 启动接口服务
const serverChild = spawn("cargo", ["run"], {
    cwd: resolve(projectRoot, "./server"),
    env,
});
processStdio("server", serverChild);

// 启动前端服务
const clientChild = spawn("npm", ["run", "dev"], {
    cwd: resolve(projectRoot, "./client"),
    env,
    shell: isWin32,
});
processStdio("client", clientChild);

// 启动前端服务
const tauriChild = spawn("tauri", ["dev"], {
    cwd: projectRoot,
    env,
    shell: isWin32,
});
processStdio("tauri", tauriChild);

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
