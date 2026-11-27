import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
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
if (existsSync(resolve(projectRoot, ".env"))) {
  process.loadEnvFile(resolve(projectRoot, ".env"));
}
const isDebugBuild = process.argv.includes("--debug");
const noBundle = process.argv.includes("--no-bundle");

const env = {
  ...process.env,
  ...(isDebugBuild ? { WEBSSH_RS_DEBUG: "true" } : {}),
  FORCE_COLOR: "3", // 强制启用颜色
  COLOR: "1",
  NPM_CONFIG_COLOR: "always",
};
if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
  env.ELECTRON_OVERRIDE_DIST_PATH = process.env.ELECTRON_OVERRIDE_DIST_PATH;
}

// 确保安装依赖
run("pnpm", ["i"], {
  cwd: resolve(projectRoot, "./src-client"),
  env,
});
run("pnpm", ["i"], {
  cwd: resolve(projectRoot, "./src-electron"),
  env,
});

// 构建Web前端
run("npm", ["run", "build"], {
  cwd: resolve(projectRoot, "./src-client"),
  env,
});

// Build the embedded Rust server used by Electron.
run("cargo", ["build", "--release", "--manifest-path", "src-server/Cargo.toml"], {
  cwd: projectRoot,
  env,
});

const serverResources = resolve(projectRoot, "src-electron/resources/server");
rmSync(serverResources, { recursive: true, force: true });
mkdirSync(serverResources, { recursive: true });
const serverBinary = process.platform === "win32" ? "webssh_rs_server.exe" : "webssh_rs_server";
cpSync(
  resolve(projectRoot, "src-server/target/release", serverBinary),
  resolve(serverResources, serverBinary),
);

const electronBuilderArgs = [];
if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
  electronBuilderArgs.push(
    `-c.electronDist=${resolve(
      projectRoot,
      process.env.ELECTRON_OVERRIDE_DIST_PATH,
    )}`,
  );
}
run("npm", ["run", noBundle ? "build:dir" : "build", "--", ...electronBuilderArgs], {
  cwd: resolve(projectRoot, "src-electron"),
  env,
});
