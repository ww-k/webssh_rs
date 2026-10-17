import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const run = (name, args, options) => {
  const result = spawnSync(name, args, {
    ...options,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`Failed to run ${name}:`, result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const projectRoot = resolve(fileURLToPath(import.meta.url), "../..");
const tauriBuildArgs = [
  resolve(projectRoot, "node_modules/@tauri-apps/cli/tauri.js"),
  "build",
];
if (process.argv.includes("--no-bundle")) {
  tauriBuildArgs.push("--no-bundle");
}

const env = {
  ...process.env,
  FORCE_COLOR: "3", // 强制启用颜色
  COLOR: "1",
  NPM_CONFIG_COLOR: "always",
};

// 确保安装依赖
run("pnpm", ["i"], {
  cwd: resolve(projectRoot, "./src-client"),
  env,
});

// 构建Web前端
run("npm", ["run", "build"], {
  cwd: resolve(projectRoot, "./src-client"),
  env,
});

// Build and bundle the Tauri application.
run(process.execPath, tauriBuildArgs, {
  cwd: projectRoot,
  env,
});
