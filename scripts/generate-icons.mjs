import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(import.meta.url), "../..");
const defaultSource = resolve(
  projectRoot,
  "design/icon-concepts/33-underscore-circle.svg",
);
const defaultOutput = resolve(projectRoot, "src-tauri/icons");
const args = process.argv.slice(2);

const sourceArgument = args.find((argument) => argument.startsWith("--source="));
const outputArgument = args.find((argument) => argument.startsWith("--output="));
const positionalSource = args.find((argument) => !argument.startsWith("--"));
const source = resolve(
  projectRoot,
  sourceArgument?.slice("--source=".length) || positionalSource || defaultSource,
);
const output = resolve(
  projectRoot,
  outputArgument?.slice("--output=".length) || defaultOutput,
);

if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: pnpm icons [source.svg] [--output=directory]");
  console.log("Default source: design/icon-concepts/33-underscore-circle.svg");
  process.exit(0);
}

if (!existsSync(source)) {
  console.error(`[icons] Source file does not exist: ${source}`);
  process.exit(1);
}

const result = spawnSync("pnpm", ["exec", "tauri", "icon", source, "-o", output], {
  cwd: projectRoot,
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(`[icons] Failed to run Tauri icon generator: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

// The desktop bundle does not use mobile icon folders or the extra 64px PNG.
rmSync(resolve(output, "android"), { recursive: true, force: true });
rmSync(resolve(output, "ios"), { recursive: true, force: true });
rmSync(resolve(output, "64x64.png"), { force: true });

console.log(`[icons] Generated desktop icon resources from ${source}`);
