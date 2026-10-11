import { spawnSync } from "node:child_process";
import { copyFileSync, lstatSync, mkdirSync } from "node:fs";
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
const tauriBuildArgs = ["build"];
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
try {
  lstatSync(resolve(projectRoot, "./src-client/node_modules"));
} catch (_err) {
  run("pnpm", ["i"], {
    cwd: resolve(projectRoot, "./src-client"),
    env,
  });
}

// 构建Web前端
run("npm", ["run", "build"], {
  cwd: resolve(projectRoot, "./src-client"),
  env,
});

// Build the API server and bundle it as a Tauri resource.
const rustTargetResult = spawnSync("rustc", ["-vV"], {
  cwd: projectRoot,
  env,
  encoding: "utf8",
});
if (rustTargetResult.status !== 0) {
  console.error("Failed to determine the Rust target triple");
  process.exit(rustTargetResult.status ?? 1);
}
const rustTarget = rustTargetResult.stdout
  .split(/\r?\n/)
  .find((line) => line.startsWith("host:"))
  ?.slice("host:".length)
  .trim();
if (!rustTarget) {
  console.error("Could not find the Rust host target triple");
  process.exit(1);
}

run("cargo", ["build", "--release", "--target", rustTarget], {
  cwd: resolve(projectRoot, "./src-server"),
  env,
});

const executable =
  process.platform === "win32" ? "webssh_rs_server.exe" : "webssh_rs_server";
const sidecarName =
  process.platform === "win32"
    ? `webssh_rs_server-${rustTarget}.exe`
    : `webssh_rs_server-${rustTarget}`;
const targetDir = resolve(
  projectRoot,
  "./src-server/target",
  rustTarget,
  "release",
);
const resourceDir = resolve(projectRoot, "./src-tauri/binaries");
mkdirSync(resourceDir, { recursive: true });
copyFileSync(resolve(targetDir, executable), resolve(resourceDir, sidecarName));

// Build and bundle the Tauri application.
run("tauri", tauriBuildArgs, {
  cwd: projectRoot,
  env,
});
