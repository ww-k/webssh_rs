import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(import.meta.url), "../..");

if (existsSync(resolve(projectRoot, ".env"))) {
  process.loadEnvFile(resolve(projectRoot, ".env"));
}

const args = process.argv.slice(2);
const modeArgument = args.find((argument) => argument.startsWith("--mode="));
const mode = modeArgument?.slice("--mode=".length) || "desktop";

if (!new Set(["browser", "desktop"]).has(mode)) {
  console.error(`[dev] Unsupported mode: ${mode}. Use browser or desktop.`);
  process.exit(1);
}

const configuredClientPort = Number.parseInt(
  process.env.WEBSSH_RS_CLIENT_PORT || "",
  10,
);
const clientPort =
  Number.isInteger(configuredClientPort) &&
  configuredClientPort > 0 &&
  configuredClientPort <= 65535
    ? configuredClientPort.toString()
    : "3000";
const baseEnv = {
  ...process.env,
  // Let the server choose an unused port. The actual port is read from its
  // startup log before the frontend process is launched.
  WEBSSH_RS_SERVER_PORT: "0",
  WEBSSH_RS_CLIENT_PORT: clientPort,
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
    env: baseEnv,
  });
}

const children = [];
let isShuttingDown = false;

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// Browser mode runs the server directly; desktop mode starts the embedded
// server through Tauri. Both servers bind port 0 and report their actual port
// through the same startup log.
const serverName = mode === "browser" ? "server" : "tauri";
const serverChild = startServer(mode, serverName);
children.push(serverChild);

let serverPort;
try {
  serverPort = await waitForServerPort(serverChild);
} catch (error) {
  console.error(`[dev] Failed to start ${serverName}: ${error.message}`);
  shutdown(1);
}

// Rsbuild reads WEBSSH_RS_SERVER_PORT while its config is evaluated, so it
// must be started only after the server has reported its selected port.
const clientEnv = {
  ...baseEnv,
  WEBSSH_RS_SERVER_PORT: String(serverPort),
};
const clientChild = spawn("npm", ["run", "dev"], {
  cwd: resolve(projectRoot, "./src-client"),
  env: clientEnv,
  shell: isWin32,
});
processStdio("client", clientChild);
children.push(clientChild);

if (mode === "browser") {
  console.log(
    `[dev] Browser mode. Open http://localhost:${clientPort} in your browser (API server: ${serverPort}).`,
  );
} else {
  console.log(
    `[dev] Desktop mode. Tauri server: http://127.0.0.1:${serverPort}.`,
  );
}

serverChild.on("exit", shutdown);
clientChild.on("exit", shutdown);

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

function startServer(mode, name) {
  const child =
    mode === "browser"
      ? spawn("cargo", ["run"], {
          cwd: resolve(projectRoot, "./src-server"),
          env: baseEnv,
        })
      : spawn(
          process.execPath,
          [
            resolve(projectRoot, "node_modules/@tauri-apps/cli/tauri.js"),
            "dev",
          ],
          {
            cwd: projectRoot,
            env: baseEnv,
          },
        );
  processStdio(name, child);
  return child;
}

function waitForServerPort(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => {
      finish(new Error("timed out waiting for the Listening log"));
    }, 120_000);

    const onOutput = (data) => {
      output += data.toString();
      const match = output.match(
        /Listening on http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})/i,
      );
      if (!match) {
        // Keep enough trailing output to match a log line split across chunks.
        output = output.slice(-4096);
        return;
      }

      const port = Number.parseInt(match[1], 10);
      if (port > 0 && port <= 65535) {
        finish(null, port);
      }
    };
    const onExit = (code, signal) => {
      finish(
        new Error(
          `process exited before reporting its port (code=${code}, signal=${signal})`,
        ),
      );
    };
    const onError = (error) => finish(error);

    child.stdout.on("data", onOutput);
    child.stderr.on("data", onOutput);
    child.once("exit", onExit);
    child.once("error", onError);

    function finish(error, port) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.stdout.off("data", onOutput);
      child.stderr.off("data", onOutput);
      child.off("exit", onExit);
      child.off("error", onError);
      if (error) {
        reject(error);
      } else {
        resolve(port);
      }
    }
  });
}
