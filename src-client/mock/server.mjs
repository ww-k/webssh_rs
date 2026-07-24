import { createMockState } from "./data.mjs";

import { createHash, randomUUID } from "node:crypto";
import { posix } from "node:path";

const state = createMockState();

export function mockMiddlewares(request, response, next) {
    if (!request.url?.startsWith("/mock_api")) {
        next();
        return;
    }

    route(request, response).catch((error) => {
        console.error("[mock] request failed", error);
        sendJson(response, 500, {
            code: 500,
            message:
                error instanceof Error ? error.message : "Mock request failed",
        });
    });
}

async function route(request, response) {
    const method = request.method || "GET";
    const url = new URL(request.url || "/", "http://localhost");
    const pathname = url.pathname.replace(/^\/mock_api/, "/api");
    const { searchParams } = url;

    if (method === "GET" && pathname === "/api/health") {
        return sendJson(response, 200, { status: "ok" });
    }

    if (pathname.startsWith("/api/target/")) {
        return handleTarget(request, response, pathname);
    }
    if (pathname.startsWith("/api/transfer/")) {
        return handleTransfer(request, response, pathname);
    }
    if (pathname.startsWith("/api/sftp/")) {
        return handleFileApi(request, response, pathname, searchParams, true);
    }
    if (pathname.startsWith("/api/fs/")) {
        return handleFileApi(request, response, pathname, searchParams, false);
    }

    sendJson(response, 404, {
        code: 404,
        message: `Mock route not found: ${pathname}`,
    });
}

async function handleTarget(request, response, pathname) {
    if (request.method === "GET" && pathname === "/api/target/list") {
        return sendJson(response, 200, state.targets);
    }

    const payload = await readJson(request);
    if (request.method === "POST" && pathname === "/api/target/add") {
        const target = {
            ...payload,
            id: Math.max(0, ...state.targets.map((item) => item.id)) + 1,
        };
        state.targets.push(target);
        return sendJson(response, 200, target);
    }
    if (request.method === "POST" && pathname === "/api/target/update") {
        const index = state.targets.findIndex((item) => item.id === payload.id);
        if (index === -1) return sendNotFound(response, "Target", payload.id);
        state.targets[index] = { ...state.targets[index], ...payload };
        return sendJson(response, 200, state.targets[index]);
    }
    if (request.method === "POST" && pathname === "/api/target/remove") {
        const index = state.targets.findIndex((item) => item.id === payload.id);
        if (index === -1) return sendNotFound(response, "Target", payload.id);
        state.targets.splice(index, 1);
        response.writeHead(200);
        return response.end();
    }
    return sendMethodNotAllowed(response);
}

async function handleTransfer(request, response, pathname) {
    if (request.method === "GET" && pathname === "/api/transfer/list") {
        return sendJson(response, 200, state.transferTasks);
    }
    if (
        request.method === "POST" &&
        ["/api/transfer/upload", "/api/transfer/download"].includes(pathname)
    ) {
        const payload = await readJson(request);
        const task = createTransferTask(pathname.endsWith("upload"), payload);
        state.transferTasks.unshift(task);
        return sendJson(response, 200, task);
    }

    const match = pathname.match(
        /^\/api\/transfer\/([^/]+)(?:\/(pause|resume|cancel))?$/,
    );
    if (!match) return sendMethodNotAllowed(response);

    const [, id, action] = match;
    const index = state.transferTasks.findIndex((item) => item.id === id);
    if (index === -1) return sendNotFound(response, "Transfer task", id);

    if (request.method === "GET" && !action) {
        return sendJson(response, 200, state.transferTasks[index]);
    }
    if (request.method === "DELETE" && !action) {
        state.transferTasks.splice(index, 1);
        response.writeHead(200);
        return response.end();
    }
    if (request.method === "POST" && action) {
        const statuses = { pause: "PAUSE", resume: "RUN", cancel: "CANCEL" };
        const status = statuses[action];
        const now = Date.now();
        state.transferTasks[index] = {
            ...state.transferTasks[index],
            status,
            speed: status === "RUN" ? 24.6 * 1024 * 1024 : 0,
            estimated_time: status === "RUN" ? 120 : undefined,
            updated_at: now,
            ended_at: status === "CANCEL" ? now : undefined,
        };
        return sendJson(response, 200, state.transferTasks[index]);
    }
    return sendMethodNotAllowed(response);
}

function createTransferTask(upload, payload) {
    const source = upload ? payload.local_path : payload.source_uri;
    const targetUri = upload ? payload.target_uri : payload.source_uri;
    const now = Date.now();
    return {
        id: `mock-transfer-${randomUUID()}`,
        type: upload ? "UPLOAD" : "DOWNLOAD",
        status: "WAIT",
        local_path: payload.local_path,
        target_uri: targetUri,
        target_id: getTargetId(targetUri),
        name: posix.basename(source || "untitled"),
        loaded: 0,
        total: 0,
        percent: 0,
        speed: 0,
        ranges: [],
        created_at: now,
        updated_at: now,
    };
}

async function handleFileApi(request, response, pathname, searchParams, sftp) {
    const prefix = sftp ? "/api/sftp" : "/api/fs";
    const entries = sftp ? state.sftpEntries : state.fsEntries;
    const requestedUri =
        searchParams.get("uri") || (sftp ? "/Users/test/Downloads" : "/");
    const uri = normalizeFilePath(requestedUri);

    if (request.method === "GET" && pathname === `${prefix}/home`) {
        const targetId = searchParams.get("target_id") || "1";
        return sendJson(
            response,
            200,
            sftp ? `sftp:${targetId}:/Users/test` : "/Users/demo",
        );
    }
    if (request.method === "GET" && pathname === `${prefix}/ls`) {
        return sendJson(response, 200, clone(entries.get(uri) || []));
    }
    if (request.method === "GET" && pathname === `${prefix}/stat`) {
        const stat = findEntry(entries, uri);
        if (!stat) return sendNotFound(response, "File", requestedUri);
        return sendJson(response, 200, stat);
    }
    if (sftp && request.method === "POST" && pathname === `${prefix}/upload`) {
        const body = await readBody(request);
        upsertFile(entries, uri, body.length);
        const hash = createHash("sha256").update(body).digest("hex");
        return sendJson(response, 200, { hash });
    }
    if (sftp && request.method === "GET" && pathname === `${prefix}/download`) {
        return sendDownload(request, response, requestedUri);
    }
    if (request.method === "POST" && pathname === `${prefix}/show-in-folder`) {
        return sendJson(response, 200, true);
    }
    if (request.method === "POST" && pathname === `${prefix}/mkdir`) {
        mutateMkdir(entries, uri);
        return sendJson(response, 200, true);
    }
    if (request.method === "POST" && pathname === `${prefix}/cp`) {
        mutateCopy(
            entries,
            uri,
            normalizeFilePath(searchParams.get("target_path") || ""),
        );
        return sendJson(response, 200, true);
    }
    if (request.method === "POST" && pathname === `${prefix}/rename`) {
        mutateRename(
            entries,
            uri,
            normalizeFilePath(searchParams.get("target_path") || ""),
        );
        return sendJson(response, 200, true);
    }
    if (
        request.method === "POST" &&
        [`${prefix}/rm`, `${prefix}/rm/rf`].includes(pathname)
    ) {
        mutateRemove(entries, uri);
        return sendJson(response, 200, true);
    }
    return sendMethodNotAllowed(response);
}

function normalizeFilePath(uri) {
    const sftpMatch = uri.match(/^sftp:\d+:(.*)$/);
    const path = sftpMatch ? sftpMatch[1] : uri;
    return posix.normalize(path || "/");
}

function findEntry(entries, uri) {
    if (entries.has(uri)) {
        return {
            name: posix.basename(uri) || "/",
            type: "d",
            size: 0,
            atime: 1_638_400_000,
            mtime: 1_638_400_000,
            permissions: "rwxr-xr-x",
        };
    }
    const parent = posix.dirname(uri);
    return entries
        .get(parent)
        ?.find((item) => item.name === posix.basename(uri));
}

function mutateMkdir(entries, uri) {
    const parent = posix.dirname(uri);
    const name = posix.basename(uri);
    const list = entries.get(parent) || [];
    if (!list.some((item) => item.name === name)) {
        list.push(mockFileStat(name, "d", 0));
        entries.set(parent, list);
    }
    entries.set(uri, entries.get(uri) || []);
}

function mutateCopy(entries, uri, targetUri) {
    const source = findEntry(entries, uri);
    if (!source) throw new Error(`File not found: ${uri}`);
    const targetParent = posix.dirname(targetUri);
    const targetName = posix.basename(targetUri);
    const list = entries.get(targetParent) || [];
    list.push({ ...source, name: targetName });
    entries.set(targetParent, list);
    if (source.type === "d")
        entries.set(targetUri, clone(entries.get(uri) || []));
}

function mutateRename(entries, uri, targetUri) {
    const source = findEntry(entries, uri);
    if (!source) throw new Error(`File not found: ${uri}`);
    const childEntries =
        source.type === "d" ? clone(entries.get(uri) || []) : undefined;
    mutateRemove(entries, uri);
    const targetParent = posix.dirname(targetUri);
    const list = entries.get(targetParent) || [];
    list.push({ ...source, name: posix.basename(targetUri) });
    entries.set(targetParent, list);
    if (childEntries) entries.set(targetUri, childEntries);
}

function mutateRemove(entries, uri) {
    const parent = posix.dirname(uri);
    const name = posix.basename(uri);
    entries.set(
        parent,
        (entries.get(parent) || []).filter((item) => item.name !== name),
    );
    for (const key of entries.keys()) {
        if (key === uri || key.startsWith(`${uri}/`)) entries.delete(key);
    }
}

function upsertFile(entries, uri, size) {
    const parent = posix.dirname(uri);
    const name = posix.basename(uri);
    const list = entries.get(parent) || [];
    const index = list.findIndex((item) => item.name === name);
    const stat = mockFileStat(name, "f", size);
    if (index === -1) list.push(stat);
    else list[index] = stat;
    entries.set(parent, list);
}

function mockFileStat(name, type, size) {
    const now = Math.floor(Date.now() / 1000);
    return {
        name,
        type,
        size,
        atime: now,
        mtime: now,
        permissions: type === "d" ? "rwxr-xr-x" : "rw-r--r--",
    };
}

function sendDownload(request, response, uri) {
    const content = Buffer.from(`Mock file content for ${uri}\n`);
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
    if (!range) {
        response.writeHead(200, {
            "content-type": "application/octet-stream",
            "content-length": content.length,
        });
        return response.end(content);
    }
    const start = Number.parseInt(range[1], 10);
    const end = Math.min(Number.parseInt(range[2], 10), content.length - 1);
    const chunk =
        start <= end ? content.subarray(start, end + 1) : Buffer.alloc(0);
    response.writeHead(206, {
        "content-type": "application/octet-stream",
        "content-length": chunk.length,
        "content-range": `bytes ${start}-${end}/${content.length}`,
    });
    response.end(chunk);
}

function getTargetId(uri) {
    const match = uri?.match(/^sftp:(\d+):/);
    return match ? Number.parseInt(match[1], 10) : undefined;
}

async function readJson(request) {
    const body = await readBody(request);
    return body.length === 0 ? {} : JSON.parse(body.toString("utf8"));
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", () => resolve(Buffer.concat(chunks)));
        request.on("error", reject);
    });
}

function sendJson(response, status, payload) {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
    });
    response.end(body);
}

function sendNotFound(response, resource, id) {
    return sendJson(response, 404, {
        code: 404,
        message: `${resource} not found: ${id}`,
    });
}

function sendMethodNotAllowed(response) {
    return sendJson(response, 405, {
        code: 405,
        message: "Method not allowed",
    });
}

function clone(value) {
    return structuredClone(value);
}
