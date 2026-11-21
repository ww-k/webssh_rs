import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

function getGitFiles(args) {
    return execFileSync("git", args, {
        cwd: packageRoot,
        encoding: "utf8",
    })
        .split("\0")
        .filter(Boolean);
}

const changedFiles = new Set([
    ...getGitFiles([
        "diff",
        "--relative",
        "--name-only",
        "-z",
        "--diff-filter=ACMR",
        "HEAD",
        "--",
        ".",
    ]),
    ...getGitFiles([
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ".",
    ]),
]);

const filesToFormat = [...changedFiles].filter((file) => {
    const absolutePath = path.resolve(packageRoot, file);
    return existsSync(absolutePath) && statSync(absolutePath).isFile();
});

if (filesToFormat.length === 0) {
    console.log("No uncommitted files to format.");
    process.exit(0);
}

const biomeBin = path.join(
    packageRoot,
    "node_modules",
    "@biomejs",
    "biome",
    "bin",
    "biome",
);
const result = spawnSync(
    process.execPath,
    [biomeBin, "format", "--write", "--", ...filesToFormat],
    { cwd: packageRoot, stdio: "inherit" },
);

if (result.error) {
    console.error(result.error.message);
    process.exit(1);
}

process.exit(result.status ?? 1);
