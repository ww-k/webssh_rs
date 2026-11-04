import { createMockState, MOCK_ROW_COUNT } from "./data.mjs";

import {
    createCipheriv,
    createDecipheriv,
    createHash,
    pbkdf2Sync,
    randomBytes,
    randomUUID,
} from "node:crypto";
import { posix } from "node:path";

const state = createMockState();
const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;
const UNFINISHED_TRANSFER_STATUSES = new Set(["WAIT", "RUN", "PAUSE", "FAIL"]);
const mebibytes = (value) => Math.round(value * MEBIBYTE);
const gibibytes = (value) => Math.round(value * GIBIBYTE);
const USER_DATA_ALGORITHM = "AES-256-GCM-PBKDF2-SHA256";

function deriveUserDataKey(password, salt) {
    return pbkdf2Sync(password, salt, 600_000, 32, "sha256");
}

function encryptUserData(document, password) {
    const salt = randomBytes(16);
    const nonce = randomBytes(12);
    const cipher = createCipheriv(
        "aes-256-gcm",
        deriveUserDataKey(password, salt),
        nonce,
    );
    cipher.setAAD(Buffer.from(USER_DATA_ALGORITHM));
    const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(document)),
        cipher.final(),
        cipher.getAuthTag(),
    ]);
    return {
        version: 1,
        algorithm: USER_DATA_ALGORITHM,
        salt: salt.toString("base64"),
        nonce: nonce.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
    };
}

function decryptUserData(envelope, password) {
    if (envelope.version !== 1 || envelope.algorithm !== USER_DATA_ALGORITHM) {
        throw new Error("invalid password or encrypted user data");
    }
    const salt = Buffer.from(envelope.salt, "base64");
    const nonce = Buffer.from(envelope.nonce, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    if (nonce.length !== 12 || ciphertext.length < 16) {
        throw new Error("invalid password or encrypted user data");
    }
    const decipher = createDecipheriv(
        "aes-256-gcm",
        deriveUserDataKey(password, salt),
        nonce,
    );
    decipher.setAAD(Buffer.from(USER_DATA_ALGORITHM));
    decipher.setAuthTag(ciphertext.subarray(-16));
    try {
        return JSON.parse(
            Buffer.concat([
                decipher.update(ciphertext.subarray(0, -16)),
                decipher.final(),
            ]).toString("utf8"),
        );
    } catch {
        throw new Error("invalid password or encrypted user data");
    }
}

export function mockMiddlewares(request, response, next) {
    const isRewrittenMockApi = request.url?.startsWith("/mock_api");
    const isSshRestMockApi =
        request.url?.startsWith("/api/ssh_connection/") ||
        request.url?.startsWith("/api/ssh_known_host/");
    if (!isRewrittenMockApi && !isSshRestMockApi) {
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
    if (pathname === "/api/logs") {
        return handleLogs(request, response);
    }
    if (pathname === "/api/preferences") {
        return handlePreferences(request, response);
    }
    if (pathname.startsWith("/api/ssh_known_host/")) {
        return handleKnownHost(request, response, pathname);
    }
    if (pathname.startsWith("/api/ssh_connection/")) {
        return handleSshConnection(request, response, pathname, searchParams);
    }
    if (pathname.startsWith("/api/favorite_directory/")) {
        return handleFavoriteDirectory(
            request,
            response,
            pathname,
            searchParams,
        );
    }
    if (pathname.startsWith("/api/user_data/")) {
        return handleUserData(request, response, pathname);
    }

    if (pathname.startsWith("/api/target/")) {
        return handleTarget(request, response, pathname);
    }
    if (pathname.startsWith("/api/transfer/")) {
        return handleTransfer(request, response, pathname, searchParams);
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

function handleLogs(request, response) {
    if (request.method !== "GET") return sendMethodNotAllowed(response);
    return sendJson(
        response,
        200,
        Array.from(
            { length: MOCK_ROW_COUNT },
            (_, index) =>
                `[mock] ${new Date(Date.now() - index * 1_000).toISOString()} request-${index + 1}`,
        ),
    );
}

async function handlePreferences(request, response) {
    if (request.method === "GET")
        return sendJson(response, 200, state.preferences);
    if (request.method === "PUT") {
        state.preferences = await readJson(request);
        return sendJson(response, 200, state.preferences);
    }
    return sendMethodNotAllowed(response);
}

async function handleKnownHost(request, response, pathname) {
    if (request.method === "GET" && pathname === "/api/ssh_known_host/list") {
        return sendJson(response, 200, state.knownHosts);
    }
    if (
        request.method === "POST" &&
        pathname === "/api/ssh_known_host/remove"
    ) {
        const payload = await readJson(request);
        const index = state.knownHosts.findIndex(
            (item) => item.id === payload.id,
        );
        if (index === -1)
            return sendNotFound(response, "Known host", payload.id);
        state.knownHosts.splice(index, 1);
        response.writeHead(200);
        return response.end();
    }
    return sendMethodNotAllowed(response);
}

async function handleSshConnection(request, response, pathname, searchParams) {
    if (request.method === "GET" && pathname === "/api/ssh_connection/list") {
        const targetId = searchParams.get("target_id");
        const connections = targetId
            ? state.sshConnections.filter(
                  (item) => item.target_id === Number(targetId),
              )
            : state.sshConnections;
        return sendJson(response, 200, connections);
    }
    if (
        request.method === "POST" &&
        ["/api/ssh_connection/expire", "/api/ssh_connection/close"].includes(
            pathname,
        )
    ) {
        const connectionId = searchParams.get("connection_id");
        const connection = state.sshConnections.find(
            (item) => item.id === connectionId,
        );
        if (!connection)
            return sendNotFound(response, "SSH connection", connectionId);
        if (pathname.endsWith("/expire")) connection.expired = true;
        else connection.closed = true;
        return sendJson(response, 200, connection);
    }
    return sendMethodNotAllowed(response);
}

async function handleFavoriteDirectory(
    request,
    response,
    pathname,
    searchParams,
) {
    if (
        request.method === "GET" &&
        pathname === "/api/favorite_directory/list"
    ) {
        const targetId = Number(searchParams.get("target_id") || 0);
        ensureFavoriteDirectories(targetId);
        return sendJson(response, 200, state.favoriteDirectories.get(targetId));
    }
    if (
        request.method === "POST" &&
        pathname === "/api/favorite_directory/initialize"
    ) {
        ensureFavoriteDirectories(Number(searchParams.get("target_id") || 0));
        response.writeHead(200);
        return response.end();
    }
    if (
        request.method === "POST" &&
        pathname === "/api/favorite_directory/add"
    ) {
        const payload = await readJson(request);
        const targetId = Number(payload.target_id || 0);
        ensureFavoriteDirectories(targetId);
        const list = state.favoriteDirectories.get(targetId);
        const existing = list.find((item) => item.path === payload.path);
        if (existing) {
            existing.name = payload.name;
            return sendJson(response, 200, existing);
        }
        const item = {
            id: nextFavoriteId(),
            target_id: targetId,
            name: payload.name,
            path: payload.path,
            is_default: false,
            created_at: Math.floor(Date.now() / 1000),
        };
        list.push(item);
        return sendJson(response, 200, item);
    }
    if (
        request.method === "POST" &&
        pathname === "/api/favorite_directory/remove"
    ) {
        const payload = await readJson(request);
        const list =
            state.favoriteDirectories.get(Number(payload.target_id || 0)) || [];
        state.favoriteDirectories.set(
            Number(payload.target_id || 0),
            list.filter((item) => item.path !== payload.path),
        );
        response.writeHead(200);
        return response.end();
    }
    return sendMethodNotAllowed(response);
}

function ensureFavoriteDirectories(targetId) {
    if (state.favoriteDirectories.has(targetId)) return;
    const prefix = targetId === 0 ? "" : `sftp:${targetId}:`;
    state.favoriteDirectories.set(
        targetId,
        [
            {
                id: targetId * 10 + 1,
                target_id: targetId,
                name: "Home",
                path: targetId === 0 ? "/Users/demo" : "/Users/test",
                is_default: true,
                created_at: 1_638_400_000,
            },
            {
                id: targetId * 10 + 2,
                target_id: targetId,
                name: "Downloads",
                path:
                    targetId === 0
                        ? "/Users/demo/Downloads"
                        : "/Users/test/Downloads",
                is_default: true,
                created_at: 1_638_400_000,
            },
        ].map((item) => ({
            ...item,
            path: item.path.replace(/^sftp:\d+:/, prefix),
        })),
    );
}

function nextFavoriteId() {
    return (
        Math.max(
            0,
            ...Array.from(state.favoriteDirectories.values())
                .flat()
                .map((item) => item.id),
        ) + 1
    );
}

async function handleUserData(request, response, pathname) {
    if (request.method === "POST" && pathname === "/api/user_data/export") {
        const payload = await readJson(request);
        const document = {
            version: 1,
            exported_at: new Date().toISOString(),
            targets: clone(state.targets),
            favorite_directories: Array.from(state.favoriteDirectories.values())
                .flat()
                .filter((item) => !item.is_default)
                .map(({ target_id, name, path }) => ({
                    target_id,
                    name,
                    path,
                })),
            settings: payload.settings ?? {},
        };
        if (!payload.password) return sendJson(response, 200, document);
        return sendJson(
            response,
            200,
            encryptUserData(document, payload.password),
        );
    }
    if (
        request.method === "POST" &&
        ["/api/user_data/import", "/api/user_data/import/url"].includes(
            pathname,
        )
    ) {
        const payload = await readJson(request);
        if (pathname === "/api/user_data/import/url") {
            const fetched = await fetch(payload.url);
            if (!fetched.ok) throw new Error(`HTTP ${fetched.status}`);
            payload.data = await fetched.json();
        }
        if (!payload.data) throw new Error("invalid user data");
        const encrypted = typeof payload.data.algorithm === "string";
        const document = encrypted
            ? decryptUserData(payload.data, payload.password || "")
            : payload.data;
        const targets = Array.isArray(document.targets) ? document.targets : [];
        const targetIds = new Set(state.targets.map((item) => item.id));
        let addedTargets = 0;
        let skippedTargets = 0;
        for (const target of targets) {
            if (targetIds.has(target.id)) skippedTargets++;
            else {
                state.targets.push({ ...target });
                targetIds.add(target.id);
                addedTargets++;
            }
        }
        const favorites = Array.isArray(document.favorite_directories)
            ? document.favorite_directories
            : [];
        for (const favorite of favorites) {
            ensureFavoriteDirectories(Number(favorite.target_id || 0));
            const list = state.favoriteDirectories.get(
                Number(favorite.target_id || 0),
            );
            if (!list.some((item) => item.path === favorite.path)) {
                list.push({
                    id: nextFavoriteId(),
                    target_id: Number(favorite.target_id || 0),
                    name: favorite.name,
                    path: favorite.path,
                    is_default: false,
                    created_at: Math.floor(Date.now() / 1000),
                });
            }
        }
        return sendJson(response, 200, {
            added_targets: addedTargets,
            skipped_targets: skippedTargets,
            imported_favorites: favorites.length,
            settings: document.settings ?? {},
        });
    }
    return sendMethodNotAllowed(response);
}

async function handleTransfer(request, response, pathname, searchParams) {
    if (
        request.method === "GET" &&
        pathname === "/api/transfer/unfinished-count"
    ) {
        const createdAfter = Number(
            searchParams.get("created_after") ||
                searchParams.get("createdAfter") ||
                0,
        );
        const count = state.transferTasks.filter(
            (task) =>
                UNFINISHED_TRANSFER_STATUSES.has(task.status) ||
                task.created_at > createdAfter,
        ).length;
        return sendJson(response, 200, { count });
    }
    if (request.method === "GET" && pathname === "/api/transfer/list") {
        const batchId = searchParams.get("batch_id");
        return sendJson(
            response,
            200,
            batchId
                ? state.transferTasks.filter(
                      (task) => task.batch_id === batchId,
                  )
                : state.transferTasks,
        );
    }
    if (request.method === "DELETE" && pathname === "/api/transfer/history") {
        state.transferTasks = state.transferTasks.filter(
            (task) => !["SUCCESS", "FAIL", "CANCEL"].includes(task.status),
        );
        return endResponse(response);
    }
    if (
        request.method === "POST" &&
        [
            "/api/transfer/batches/upload",
            "/api/transfer/batches/download",
        ].includes(pathname)
    ) {
        const payload = await readJson(request);
        const batch = createTransferBatch(
            pathname.endsWith("/upload"),
            payload,
        );
        state.transferBatches.set(batch.id, batch);
        state.transferTasks.unshift(...batch.tasks);
        return sendJson(response, 200, withoutBatchTasks(batch));
    }
    const batchMatch = pathname.match(
        /^\/api\/transfer\/batches\/([^/]+)(?:\/(pause|resume|cancel))?$/,
    );
    if (batchMatch) {
        const [, batchId, action] = batchMatch;
        const batch = state.transferBatches.get(batchId);
        if (!batch) return sendNotFound(response, "Transfer batch", batchId);
        if (request.method === "DELETE" && !action) {
            state.transferTasks = state.transferTasks.filter(
                (task) => task.batch_id !== batchId,
            );
            state.transferBatches.delete(batchId);
            return endResponse(response);
        }
        if (request.method === "POST" && action) {
            const statuses = {
                pause: "PAUSE",
                resume: "RUN",
                cancel: "CANCEL",
            };
            const status = statuses[action];
            batch.status = status;
            batch.updated_at = Date.now();
            if (status === "CANCEL") batch.ended_at = batch.updated_at;
            updateBatchTasks(batchId, status);
            return sendJson(response, 200, withoutBatchTasks(batch));
        }
        return sendMethodNotAllowed(response);
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

function createTransferBatch(upload, payload) {
    const now = Date.now();
    const id = `mock-batch-${randomUUID()}`;
    const sources = Array.isArray(payload.sources) ? payload.sources : [];
    const targetId = upload ? getTargetId(payload.target_uri) : undefined;
    const tasks = sources.map((source, index) => {
        const name = posix.basename(source || `item-${index + 1}`);
        const targetUri = upload
            ? `${String(payload.target_uri || "").replace(/\/$/, "")}/${name}`
            : source;
        const localPath = upload
            ? source
            : `${String(payload.local_dir || "/Users/demo/Downloads").replace(/[\\/]$/, "")}/${name}`;
        return {
            id: `${id}-task-${index + 1}`,
            type: upload ? "UPLOAD" : "DOWNLOAD",
            kind: "FILE",
            status: "WAIT",
            local_path: localPath,
            target_uri: targetUri,
            target_id: targetId || getTargetId(source),
            name,
            loaded: 0,
            total: gibibytes(1),
            percent: 0,
            speed: 0,
            ranges: [],
            created_at: now,
            updated_at: now,
            batch_id: id,
            conflict_policy: payload.conflict_policy || "OVERWRITE",
            all: Boolean(payload.all),
        };
    });
    return {
        id,
        type: upload ? "UPLOAD" : "DOWNLOAD",
        status: "WAIT",
        name: payload.name || "Mock transfer",
        target_id: targetId,
        conflict_policy: payload.conflict_policy || "OVERWRITE",
        item_count: tasks.length,
        completed_count: 0,
        failed_count: 0,
        directory_count: 0,
        directory_failed_count: 0,
        total: tasks.reduce((sum, task) => sum + task.total, 0),
        loaded: 0,
        percent: 0,
        speed: 0,
        estimated_time: undefined,
        created_at: now,
        updated_at: now,
        tasks,
    };
}

function withoutBatchTasks(batch) {
    const { tasks: _tasks, ...response } = batch;
    return response;
}

function updateBatchTasks(batchId, status) {
    const now = Date.now();
    state.transferTasks = state.transferTasks.map((task) =>
        task.batch_id === batchId
            ? {
                  ...task,
                  status,
                  speed: status === "RUN" ? mebibytes(24.6) : 0,
                  updated_at: now,
                  ended_at: status === "CANCEL" ? now : task.ended_at,
              }
            : task,
    );
    const batch = state.transferBatches.get(batchId);
    if (!batch) return;
    batch.tasks = state.transferTasks.filter(
        (task) => task.batch_id === batchId,
    );
    batch.loaded = batch.tasks.reduce((sum, task) => sum + task.loaded, 0);
    batch.completed_count = batch.tasks.filter(
        (task) => task.status === "SUCCESS",
    ).length;
    batch.failed_count = batch.tasks.filter((task) =>
        ["FAIL", "CANCEL"].includes(task.status),
    ).length;
    batch.percent =
        batch.total === 0
            ? 0
            : Number(((batch.loaded / batch.total) * 100).toFixed(2));
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
    if (request.method === "GET" && pathname === `${prefix}/user-dirs/home`) {
        const targetId = searchParams.get("target_id") || "1";
        return sendJson(
            response,
            200,
            sftp ? `sftp:${targetId}:/Users/test` : "/Users/demo",
        );
    }
    if (
        request.method === "GET" &&
        pathname === `${prefix}/user-dirs/download`
    ) {
        return sendJson(
            response,
            200,
            sftp
                ? `sftp:${searchParams.get("target_id") || "1"}:/Users/test/Downloads`
                : "/Users/demo/Downloads",
        );
    }
    if (request.method === "GET" && pathname === `${prefix}/user-dirs`) {
        const targetId = searchParams.get("target_id") || "1";
        const root = sftp ? `sftp:${targetId}:/Users/test` : "/Users/demo";
        return sendJson(response, 200, [
            { name: "/", path: sftp ? `sftp:${targetId}:/` : "/" },
            { name: "Home", path: root },
            { name: "Desktop", path: `${root}/Desktop` },
            { name: "Documents", path: `${root}/Documents` },
            { name: "Downloads", path: `${root}/Downloads` },
        ]);
    }
    if (request.method === "GET" && pathname === `${prefix}/ls`) {
        ensureLargeDirectory(entries, uri);
        return sendJson(response, 200, clone(entries.get(uri) || []));
    }
    if (request.method === "GET" && pathname === `${prefix}/stat`) {
        ensureLargeDirectory(entries, posix.dirname(uri));
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
    if (!sftp && request.method === "POST" && pathname === `${prefix}/open`) {
        await readBody(request);
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

function ensureLargeDirectory(entries, uri) {
    const list = entries.get(uri) || [];
    if (list.length >= MOCK_ROW_COUNT) return;
    const now = Math.floor(Date.now() / 1000);
    for (let index = list.length; index < MOCK_ROW_COUNT; index++) {
        list.push({
            name: `mock-entry-${index + 1}.txt`,
            type: "f",
            size: 1024 + (index % 100) * 1024,
            atime: now,
            mtime: now,
            permissions: "rw-r--r--",
        });
    }
    entries.set(uri, list);
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

function endResponse(response) {
    response.writeHead(200);
    response.end();
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
