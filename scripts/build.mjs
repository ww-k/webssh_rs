import { spawnSync } from "node:child_process";
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

// 确保安装依赖
try {
    lstatSync(resolve(projectRoot, "./client/node_modules"));
} catch (_err) {
    spawnSync("pnpm i", {
        cwd: resolve(projectRoot, "./client"),
        env,
    });
}

// 构建Web前端
spawnSync("npm", ["run", "build"], {
    cwd: resolve(projectRoot, "./client"),
    env,
    stdio: "inherit",
});

// 构建tauri;
spawnSync("tauri", ["build"], {
    cwd: projectRoot,
    env,
    stdio: "inherit",
});
