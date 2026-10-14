import { spawn, spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { createServer } from "node:net";
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

const configuredServerPort = Number.parseInt(
  process.env.WEBSSH_RS_SERVER_PORT || "",
  10,
);
const serverPort =
  Number.isInteger(configuredServerPort) &&
  configuredServerPort > 0 &&
  configuredServerPort <= 65535
    ? configuredServerPort.toString()
    : (await findAvailablePort()).toString();
const env = {
  ...process.env,
  WEBSSH_RS_SERVER_PORT: serverPort,
  FORCE_COLOR: "3", // 强制启用颜色
  COLOR: "1",
  NPM_CONFIG_COLOR: "always",
};
const isWin32 = process.platform === "win32";

async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (!address || typeof address === "string") {
    throw new Error("Failed to allocate a development server port");
  }
  return address.port;
}

// 确保安装依赖
try {
  lstatSync(resolve(projectRoot, "./src-client/node_modules"));
} catch (_err) {
  spawnSync("pnpm", ["install"], {
    cwd: resolve(projectRoot, "./src-client"),
    env,
  });
}

// 浏览器模式由脚本启动独立 server；桌面模式由 Tauri 内嵌启动 server。
const serverChild =
  mode === "browser"
    ? spawn("cargo", ["run"], {
        cwd: resolve(projectRoot, "./src-server"),
        env,
      })
    : null;
if (serverChild) {
  processStdio("server", serverChild);
}

// 启动前端服务
const clientChild = spawn("npm", ["run", "dev"], {
  cwd: resolve(projectRoot, "./src-client"),
  env,
  shell: isWin32,
});
processStdio("client", clientChild);

const children = [serverChild, clientChild].filter(Boolean);

if (mode === "browser") {
  console.log(
    `[dev] Browser mode. Open http://localhost:3000 in your browser (API server: ${serverPort}).`,
  );
  serverChild?.on("exit", shutdown);
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
    terminateProcessTree(child);
  }
  process.exit(code ?? 0);
}

function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (isWin32) {
    // npm and Tauri are launched through cmd.exe on Windows. Killing only the
    // wrapper leaves Vite/Rsbuild running and keeps port 3000 occupied.
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    });
    return;
  }

  child.kill("SIGTERM");
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
