import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(import.meta.url), "../..");
const releaseFiles = [
  "package.json",
  "src-client/package.json",
  "src-server/Cargo.toml",
  "src-tauri/Cargo.toml",
  "src-tauri/tauri.conf.json",
  "scripts/release.mjs",
  "README.md",
];
const releaseFileSet = new Set(releaseFiles);

const inputVersion = process.argv[2];
const version = inputVersion?.replace(/^v/, "");

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: pnpm release <version> (for example: pnpm release 0.5.0)");
  process.exit(1);
}

const changedFiles = runGit(["status", "--porcelain", "-z"])
  .stdout.split("\0")
  .filter(Boolean)
  .map((entry) => entry.slice(3));
const unexpectedChanges = changedFiles.filter((file) => !releaseFileSet.has(file));
if (unexpectedChanges.length > 0) {
  console.error(
    `Release aborted: unrelated changes detected (${unexpectedChanges.join(", ")}).`,
  );
  process.exit(1);
}

await updateJson("package.json", (manifest) => {
  manifest.version = version;
});
await updateJson("src-client/package.json", (manifest) => {
  manifest.version = version;
});
await updateJson("src-tauri/tauri.conf.json", (config) => {
  config.version = version;
});
await updateCargo("src-server/Cargo.toml");
await updateCargo("src-tauri/Cargo.toml");

const addResult = runGit(["add", "--", ...releaseFiles]);
if (addResult.status !== 0) {
  process.exit(addResult.status ?? 1);
}

const commitMessage = `chore(release): v${version}`;
const commitResult = runGit(["commit", "-m", commitMessage], { inheritStdio: true });
if (commitResult.status !== 0) {
  process.exit(commitResult.status ?? 1);
}

console.log(`Released v${version} in commit ${commitMessage}.`);

async function updateJson(relativePath, update) {
  const filePath = resolve(projectRoot, relativePath);
  const original = await readFile(filePath, "utf8");
  const manifest = JSON.parse(original);
  update(manifest);
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const indent = original.match(/^[ \t]+(?="version")/m)?.[0].length ?? 4;
  const updated = `${JSON.stringify(manifest, null, indent)}${newline}`;
  await writeFile(filePath, updated);
}

async function updateCargo(relativePath) {
  const filePath = resolve(projectRoot, relativePath);
  const original = await readFile(filePath, "utf8");
  const versionLine = original.match(/^\s*version\s*=\s*"[^"]+"\s*$/m);
  if (!versionLine) {
    throw new Error(`Could not find a package version in ${relativePath}.`);
  }

  const updated = original.replace(
    /(^\s*version\s*=\s*")[^"]+("\s*$)/m,
    `$1${version}$2`,
  );

  await writeFile(filePath, updated);
}

function runGit(args, options = {}) {
  return spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: options.inheritStdio ? "inherit" : "pipe",
  });
}
