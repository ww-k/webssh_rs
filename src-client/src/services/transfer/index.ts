import {
    deleteTransferBatch,
    deleteTransferDirectory,
    deleteTransferHistory,
    deleteTransferTask,
    getTransferTree,
    getTransferUnfinishedCount,
    postTransferBatchCancel,
    postTransferBatchPause,
    postTransferBatchResume,
    postTransferCancel,
    postTransferDirectoryCancel,
    postTransferDirectoryPause,
    postTransferDirectoryResume,
    postTransferDownload,
    postTransferDownloadBatch,
    postTransferPause,
    postTransferResume,
    postTransferUpload,
    postTransferUploadBatch,
} from "@/api";

import type { ITransferTask, ITransferTreeNode } from "@/api";

const ACTIVE_STATUSES = new Set(["WAIT", "RUN"]);
const FINISHED_STATUSES = new Set(["SUCCESS", "FAIL", "CANCEL"]);
const UNFINISHED_STATUSES = new Set(["WAIT", "RUN", "PAUSE", "FAIL"]);
const SYNC_INTERVAL = 1000;

type TransferTreeListener = (tree: ITransferTreeNode[]) => void;
type TransferCountListener = (count: number) => void;

type TransferOperationRecord = Pick<
    ITransferTreeNode,
    "id" | "node_type" | "status"
>;

interface IUploadOption {
    localPath: string;
    fileUri: string;
}

interface IDownloadOption {
    fileUri: string;
    localPath?: string;
    localDir?: string;
    size?: number;
    all?: boolean;
}

const getTransferItemName = (source: string) => {
    const normalized = source.replace(/[\\/]+$/, "");
    const name = normalized.split(/[\\/]/).pop() || "";
    return name || normalized;
};

const findTransferNode = (
    nodes: ITransferTreeNode[],
    id: string,
): ITransferTreeNode | undefined => {
    for (const node of nodes) {
        if (node.id === id) return node;
        const descendant = findTransferNode(node.children, id);
        if (descendant) return descendant;
    }
    return undefined;
};

const findFirstTransferTask = (
    nodes: ITransferTreeNode[],
): ITransferTask | undefined => {
    for (const node of nodes) {
        if (node.node_type !== "BATCH") {
            const { children: _children, node_type: _nodeType, ...task } = node;
            return task as ITransferTask;
        }
        const descendant = findFirstTransferTask(node.children);
        if (descendant) return descendant;
    }
    return undefined;
};

const countUnfinishedNodes = (nodes: ITransferTreeNode[]): number =>
    nodes.reduce(
        (count, node) =>
            count +
            (node.node_type !== "BATCH" && UNFINISHED_STATUSES.has(node.status)
                ? 1
                : 0) +
            countUnfinishedNodes(node.children),
        0,
    );

const countFinishedNodes = (nodes: ITransferTreeNode[]): number =>
    nodes.reduce(
        (count, node) =>
            count +
            (node.node_type !== "BATCH" && FINISHED_STATUSES.has(node.status)
                ? 1
                : 0) +
            countFinishedNodes(node.children),
        0,
    );

const hasActiveNode = (nodes: ITransferTreeNode[]): boolean =>
    nodes.some(
        (node) =>
            (node.node_type !== "BATCH" && ACTIVE_STATUSES.has(node.status)) ||
            hasActiveNode(node.children),
    );

export const getTransferBatchName = (sources: string[]) => {
    const first = getTransferItemName(sources[0] || "Transfer");
    return sources.length === 1 ? first : `${first} 等 ${sources.length} 个`;
};

class TransferService {
    #syncTimer?: number;
    #countSyncTimer?: number;
    #syncing = false;
    #countSyncing = false;
    #countSyncQueued = false;
    #tree: ITransferTreeNode[] = [];
    #treeListeners = new Set<TransferTreeListener>();
    #countListeners = new Set<TransferCountListener>();

    setConfig(_option: {
        /** 并发任务数 */
        concurrency?: number;
        /** 每个任务执行间的间隔 */
        interval?: number;
    }) {}

    getTree() {
        return this.#tree;
    }

    getFinishedHistoryCount() {
        return countFinishedNodes(this.#tree);
    }

    async createUploadBatch(option: {
        sources: string[];
        targetUri: string;
        name?: string;
        all?: boolean;
        conflictPolicy?: "OVERWRITE" | "SKIP" | "RENAME" | "FAIL";
    }) {
        const batch = await postTransferUploadBatch({
            target_uri: option.targetUri,
            sources: option.sources,
            name: option.name || getTransferBatchName(option.sources),
            all: option.all ?? false,
            conflict_policy: option.conflictPolicy,
        });
        this.#taskCreated();
        return batch;
    }

    async createDownloadBatch(option: {
        sources: string[];
        localDir: string;
        name?: string;
        all?: boolean;
        conflictPolicy?: "OVERWRITE" | "SKIP" | "RENAME" | "FAIL";
    }) {
        const batch = await postTransferDownloadBatch({
            sources: option.sources,
            local_dir: option.localDir,
            name: option.name || getTransferBatchName(option.sources),
            all: option.all ?? false,
            conflict_policy: option.conflictPolicy,
        });
        this.#taskCreated();
        return batch;
    }

    async pauseBatch(id: string) {
        const batch = await postTransferBatchPause(id);
        await this.syncTasks();
        return batch;
    }
    async resumeBatch(id: string) {
        const batch = await postTransferBatchResume(id);
        await this.syncTasks();
        this.#taskCreated();
        return batch;
    }
    async cancelBatch(id: string) {
        const batch = await postTransferBatchCancel(id);
        await this.syncTasks();
        return batch;
    }

    async pauseDirectory(record: TransferOperationRecord) {
        const result = await postTransferDirectoryPause(record.id);
        await this.syncTasks();
        return result;
    }

    async resumeDirectory(record: TransferOperationRecord) {
        const result = await postTransferDirectoryResume(record.id);
        await this.syncTasks();
        return result;
    }

    async cancelDirectory(record: TransferOperationRecord) {
        const result = await postTransferDirectoryCancel(record.id);
        await this.syncTasks();
        return result;
    }

    subscribeTree(listener: TransferTreeListener) {
        const wasEmpty = this.#treeListeners.size === 0;
        this.#treeListeners.add(listener);
        listener(this.#tree);
        if (wasEmpty) {
            this.#clearCountSyncTimer();
            this.syncTasks().catch((err) => {
                console.warn("TransferService.syncTasks failed", err);
            });
        }
        return () => {
            this.#treeListeners.delete(listener);
            if (this.#treeListeners.size === 0) {
                this.#clearSyncTimer();
                this.#startCountSync();
            }
        };
    }

    subscribeUnfinishedCount(listener: TransferCountListener) {
        this.#countListeners.add(listener);
        if (this.#treeListeners.size > 0) {
            this.#clearCountSyncTimer();
            listener(countUnfinishedNodes(this.#tree));
        } else {
            this.#startCountSync();
        }

        return () => {
            this.#countListeners.delete(listener);
            if (this.#countListeners.size === 0) {
                this.#clearCountSyncTimer();
            }
        };
    }

    async upload(option: IUploadOption) {
        if (typeof postTransferUploadBatch === "function") {
            const batch = await this.createUploadBatch({
                sources: [option.localPath],
                targetUri:
                    option.fileUri.slice(0, option.fileUri.lastIndexOf("/")) ||
                    option.fileUri,
                all: false,
            });
            const task = findFirstTransferTask(
                await getTransferTree({ batch_id: batch.id }),
            );
            if (task) {
                await this.syncTree();
                return task;
            }
        }
        const task = await postTransferUpload({
            local_path: option.localPath,
            target_uri: option.fileUri,
        });
        this.#taskCreated(task);
        await this.syncTree();
        return task;
    }

    async download(option: IDownloadOption) {
        if (
            typeof postTransferDownloadBatch === "function" &&
            option.localDir
        ) {
            const batch = await this.createDownloadBatch({
                sources: [option.fileUri],
                localDir: option.localDir,
                all: option.all ?? false,
            });
            const task = findFirstTransferTask(
                await getTransferTree({ batch_id: batch.id }),
            );
            if (task) {
                await this.syncTree();
                return {
                    ...task,
                    total: task.total || option.size || 0,
                };
            }
        }
        const task = await postTransferDownload({
            source_uri: option.fileUri,
            local_path: option.localPath,
            local_dir: option.localDir,
        });
        const result = {
            ...task,
            total: task.total || option.size || 0,
        };
        this.#taskCreated(task);
        await this.syncTree();
        return result;
    }

    async syncTasks() {
        if (this.#syncing) {
            return this.#tree;
        }

        this.#syncing = true;
        try {
            if (typeof getTransferTree !== "function") {
                return this.#tree;
            }
            let tree: ITransferTreeNode[];
            try {
                tree = await getTransferTree();
            } catch (err) {
                console.warn("TransferService.syncTree failed", err);
                return this.#tree;
            }
            this.#setTree(tree);
            if (hasActiveNode(tree)) {
                this.#ensureSyncTimer();
            } else {
                this.#clearSyncTimer();
            }
            return tree;
        } finally {
            this.#syncing = false;
        }
    }

    async syncTree() {
        await this.syncTasks();
        return this.#tree;
    }

    async pause(record: TransferOperationRecord) {
        const task = await postTransferPause(record.id);
        await this.syncTree();
        return task;
    }

    async resume(record: TransferOperationRecord) {
        const task = await postTransferResume(record.id);
        await this.syncTree();
        this.#taskCreated(task);
        return task;
    }

    async cancel(record: TransferOperationRecord) {
        const task = await postTransferCancel(record.id);
        await this.syncTree();
        return task;
    }

    async remove(record: TransferOperationRecord) {
        if (["WAIT", "RUN", "PAUSE"].includes(record.status)) {
            try {
                await postTransferCancel(record.id);
            } catch (err) {
                console.warn("TransferService.remove cancel failed", err);
            }
        }
        await deleteTransferTask(record.id);
        await this.syncTree();
    }

    async pauseById(id: string) {
        const record = await this.#getOperationRecord(id);
        if (record.node_type === "BATCH") return this.pauseBatch(id);
        return record.node_type === "DIRECTORY"
            ? this.pauseDirectory(record)
            : this.pause(record);
    }

    async resumeById(id: string) {
        const record = await this.#getOperationRecord(id);
        if (record.node_type === "BATCH") return this.resumeBatch(id);
        return record.node_type === "DIRECTORY"
            ? this.resumeDirectory(record)
            : this.resume(record);
    }

    async cancelById(id: string) {
        const record = await this.#getOperationRecord(id);
        if (record.node_type === "BATCH") return this.cancelBatch(id);
        return record.node_type === "DIRECTORY"
            ? this.cancelDirectory(record)
            : this.cancel(record);
    }

    async removeById(id: string) {
        const record = await this.#getOperationRecord(id);
        if (record.node_type === "BATCH") return this.removeBatch(id);
        if (record.node_type === "DIRECTORY")
            return this.removeDirectory(record);
        return this.remove(record);
    }

    pauseAll() {}

    resumeAll() {}

    async removeAll() {
        await deleteTransferHistory();
        await this.syncTree();
    }

    async removeBatch(id: string) {
        await deleteTransferBatch(id);
        await this.syncTree();
    }

    async removeDirectory(record: TransferOperationRecord) {
        await deleteTransferDirectory(record.id);
        await this.syncTree();
    }

    #ensureSyncTimer(task?: ITransferTask) {
        if (this.#treeListeners.size === 0) {
            return;
        }
        if (task && !ACTIVE_STATUSES.has(task.status)) {
            return;
        }
        if (this.#syncTimer !== undefined) {
            return;
        }

        this.#syncTimer = window.setInterval(() => {
            this.syncTasks().catch((err) => {
                console.warn("TransferService.syncTasks failed", err);
            });
        }, SYNC_INTERVAL);
    }

    #clearSyncTimer() {
        if (this.#syncTimer !== undefined) {
            window.clearInterval(this.#syncTimer);
            this.#syncTimer = undefined;
        }
    }

    #clearCountSyncTimer() {
        if (this.#countSyncTimer !== undefined) {
            window.clearInterval(this.#countSyncTimer);
            this.#countSyncTimer = undefined;
        }
    }

    #startCountSync() {
        if (
            this.#treeListeners.size > 0 ||
            this.#countListeners.size === 0 ||
            this.#countSyncTimer !== undefined
        ) {
            return;
        }
        if (this.#countSyncing) {
            this.#countSyncQueued = true;
            return;
        }
        this.#syncUnfinishedCount().catch((err) => {
            console.warn("TransferService.syncUnfinishedCount failed", err);
            this.#scheduleCountSyncTimer();
        });
    }

    async #syncUnfinishedCount() {
        if (
            this.#treeListeners.size > 0 ||
            this.#countListeners.size === 0 ||
            this.#countSyncing
        ) {
            if (this.#countSyncing) this.#countSyncQueued = true;
            return;
        }
        this.#countSyncing = true;
        try {
            const results = await Promise.all(
                [...this.#countListeners].map(async (listener) => {
                    const count = await getTransferUnfinishedCount();
                    if (
                        this.#treeListeners.size === 0 &&
                        this.#countListeners.has(listener)
                    ) {
                        listener(count);
                    }
                    return count;
                }),
            );
            if (this.#treeListeners.size > 0) {
                this.#clearCountSyncTimer();
                return;
            }
            if (results.some((count) => count > 0)) {
                this.#scheduleCountSyncTimer();
            } else {
                this.#clearCountSyncTimer();
            }
        } finally {
            this.#countSyncing = false;
            if (
                this.#countSyncQueued &&
                this.#treeListeners.size === 0 &&
                this.#countListeners.size > 0
            ) {
                this.#countSyncQueued = false;
                this.#clearCountSyncTimer();
                this.#startCountSync();
            } else {
                this.#countSyncQueued = false;
            }
        }
    }

    #taskCreated(task?: ITransferTask) {
        this.#ensureSyncTimer(task);
        if (this.#treeListeners.size === 0) {
            this.#clearCountSyncTimer();
            this.#startCountSync();
        }
    }

    #scheduleCountSyncTimer() {
        if (
            this.#treeListeners.size > 0 ||
            this.#countListeners.size === 0 ||
            this.#countSyncTimer !== undefined
        ) {
            return;
        }
        this.#countSyncTimer = window.setInterval(() => {
            this.#syncUnfinishedCount().catch((err) => {
                console.warn("TransferService.syncUnfinishedCount failed", err);
            });
        }, SYNC_INTERVAL);
    }

    #setTree(tree: ITransferTreeNode[]) {
        this.#tree = tree;
        for (const listener of this.#treeListeners) {
            listener(tree);
        }
        this.#emitUnfinishedCounts();
    }

    #getOperationRecord(id: string) {
        const record = findTransferNode(this.#tree, id);
        if (record) return Promise.resolve(record);
        return this.syncTree().then((tree) => {
            const record = findTransferNode(tree, id);
            if (!record) {
                throw new Error(`Transfer node not found: ${id}`);
            }
            return record;
        });
    }

    #emitUnfinishedCounts() {
        if (this.#treeListeners.size === 0) return;
        const count = countUnfinishedNodes(this.#tree);
        for (const listener of this.#countListeners) {
            listener(count);
        }
    }
}

export default new TransferService();
