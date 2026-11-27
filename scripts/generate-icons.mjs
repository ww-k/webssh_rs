import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(import.meta.url), "../..");
const defaultSource = resolve(
  projectRoot,
  "design/icon-concepts/34-underscore-open.svg",
);
const defaultOutput = resolve(projectRoot, "src-electron/assets");
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
const iconGenerator = resolve(
  projectRoot,
  "src-electron/node_modules/icon-gen/dist/bin/index.js",
);

if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: pnpm gen-icons [source.svg] [--output=directory]");
  console.log("Default source: design/icon-concepts/34-underscore-open.svg");
  console.log("Default output: src-electron/assets");
  process.exit(0);
}

if (!existsSync(source)) {
  console.error(`[icons] Source file does not exist: ${source}`);
  process.exit(1);
}

mkdirSync(output, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    iconGenerator,
    `--input=${source}`,
    `--output=${output}`,
    "--ico",
    "--icns",
    "--favicon",
    "--ico-name=icon",
    "--icns-name=icon",
    "--favicon-name=icon-",
    "--favicon-png-sizes=512",
    "--favicon-ico-sizes=16,32,48,64,256",
  ],
  {
    cwd: projectRoot,
    env: process.env,
    shell: false,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`[icons] Failed to run Electron icon generator: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const generatedPng = resolve(output, "icon-512.png");
if (!existsSync(generatedPng)) {
  console.error(`[icons] Electron icon generator did not create ${generatedPng}`);
  process.exit(1);
}

rmSync(resolve(output, "icon.png"), { force: true });
renameSync(generatedPng, resolve(output, "icon.png"));
rmSync(resolve(output, "favicon.ico"), { force: true });

console.log(`[icons] Generated Electron icon resources in ${output}`);
