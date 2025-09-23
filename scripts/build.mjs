import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(import.meta.url), "../..");

const env = {
    ...process.env,
    FORCE_COLOR: "3", // 强制启用颜色
    COLOR: "1",
    NPM_CONFIG_COLOR: "always",
};

console.log("Building client...");
// 构建Web前端
const result1 = execSync("npm run build", {
    cwd: resolve(projectRoot, "./client"),
    env,
});
console.log(result1.toString());

console.log("Building tauri...");
// 启动tauri
const result2 = execSync("tauri build", {
    cwd: projectRoot,
    env,
});
console.log(result2.toString());
