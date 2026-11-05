import {
    deleteTransferBatch,
    deleteTransferHistory,
    deleteTransferTask,
    getTransferTasks,
    getTransferUnfinishedCount,
    postTransferBatchCancel,
    postTransferBatchPause,
    postTransferBatchResume,
    postTransferCancel,
    postTransferDownload,
    postTransferDownloadBatch,
    postTransferPause,
    postTransferResume,
    postTransferUpload,
    postTransferUploadBatch,
} from "@/api";

import type { ITransferTask } from "@/api";

const ACTIVE_STATUSES = new Set(["WAIT", "RUN"]);
const FINISHED_STATUSES = new Set(["SUCCESS", "FAIL", "CANCEL"]);
const UNFINISHED_STATUSES = new Set(["WAIT", "RUN", "PAUSE", "FAIL"]);
const SYNC_INTERVAL = 1000;

type TransferTasksListener = (tasks: ITransferTask[]) => void;
type TransferCountListener = (count: number) => void;

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
    #tasks: ITransferTask[] = [];
    #listeners = new Set<TransferTasksListener>();
    #countListeners = new Set<TransferCountListener>();

    setConfig(_option: {
        /** 并发任务数 */
        concurrency?: number;
        /** 每个任务执行间的间隔 */
        interval?: number;
    }) {}

    getTasks() {
        return this.#tasks;
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

    subscribe(listener: TransferTasksListener) {
        const wasEmpty = this.#listeners.size === 0;
        this.#listeners.add(listener);
        if (wasEmpty) {
            this.#clearCountSyncTimer();
        }
        listener(this.#tasks);
        this.#emitUnfinishedCounts();
        this.syncTasks().catch((err) => {
            console.warn("TransferService.syncTasks failed", err);
        });

        return () => {
            this.#listeners.delete(listener);
            if (this.#listeners.size === 0) {
                this.#clearSyncTimer();
                this.#startCountSync();
            }
        };
    }

    subscribeUnfinishedCount(listener: TransferCountListener) {
        this.#countListeners.add(listener);
        if (this.#listeners.size > 0) {
            this.#clearCountSyncTimer();
            listener(this.#getUnfinishedCount());
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
            const items = await getTransferTasks({ batch_id: batch.id });
            const task = items[0];
            if (task) {
                this.#upsertTask(task);
                return task;
            }
        }
        const task = await postTransferUpload({
            local_path: option.localPath,
            target_uri: option.fileUri,
        });
        this.#upsertTask(task);
        this.#taskCreated(task);
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
            const items = await getTransferTasks({ batch_id: batch.id });
            const task = items[0];
            if (task) {
                this.#upsertTask({
                    ...task,
                    total: task.total || option.size || 0,
                });
                return task;
            }
        }
        const task = await postTransferDownload({
            source_uri: option.fileUri,
            local_path: option.localPath,
            local_dir: option.localDir,
        });
        this.#upsertTask({
            ...task,
            total: task.total || option.size || 0,
        });
        this.#taskCreated(task);
        return task;
    }

    async syncTasks() {
        if (this.#syncing) {
            return this.#tasks;
        }

        this.#syncing = true;
        try {
            const tasks = await getTransferTasks();
            this.#setTasks(tasks);
            if (tasks.some((task) => ACTIVE_STATUSES.has(task.status))) {
                this.#ensureSyncTimer();
            } else {
                this.#clearSyncTimer();
            }
            return tasks;
        } finally {
            this.#syncing = false;
        }
    }

    async pause(id: string) {
        const task = await postTransferPause(id);
        this.#upsertTask(task);
        return task;
    }

    async resume(id: string) {
        const task = await postTransferResume(id);
        this.#upsertTask(task);
        this.#taskCreated(task);
        return task;
    }

    async cancel(id: string) {
        const task = await postTransferCancel(id);
        this.#upsertTask(task);
        return task;
    }

    async remove(id: string) {
        const record = this.#tasks.find((task) => task.id === id);
        if (record && ["WAIT", "RUN", "PAUSE"].includes(record.status)) {
            try {
                const task = await postTransferCancel(id);
                this.#upsertTask(task);
            } catch (err) {
                console.warn("TransferService.remove cancel failed", err);
            }
        }
        await deleteTransferTask(id);
        this.#deleteTask(id);
    }

    pauseAll() {}

    resumeAll() {}

    async removeAll() {
        await deleteTransferHistory();
        this.#tasks = this.#tasks.filter(
            (task) => !FINISHED_STATUSES.has(task.status),
        );
        this.#emitTasks();
        this.#emitUnfinishedCounts();
    }

    async removeBatch(id: string) {
        await deleteTransferBatch(id);
        await this.syncTasks();
    }

    #ensureSyncTimer(task?: ITransferTask) {
        if (this.#listeners.size === 0) {
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
            this.#listeners.size > 0 ||
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
            this.#listeners.size > 0 ||
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
                        this.#listeners.size === 0 &&
                        this.#countListeners.has(listener)
                    ) {
                        listener(count);
                    }
                    return count;
                }),
            );
            if (this.#listeners.size > 0) {
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
                this.#listeners.size === 0 &&
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
        if (this.#listeners.size === 0) {
            this.#clearCountSyncTimer();
            this.#startCountSync();
        }
    }

    #scheduleCountSyncTimer() {
        if (
            this.#listeners.size > 0 ||
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

    #getUnfinishedCount() {
        return this.#tasks.filter((task) =>
            UNFINISHED_STATUSES.has(task.status),
        ).length;
    }

    #setTasks(tasks: ITransferTask[]) {
        this.#tasks = tasks;
        this.#emitTasks();
        if (this.#listeners.size > 0) {
            this.#emitUnfinishedCounts();
        }
    }

    #upsertTask(task: ITransferTask) {
        const index = this.#tasks.findIndex((item) => item.id === task.id);
        if (index === -1) {
            this.#tasks = [task, ...this.#tasks];
        } else {
            const tasks = [...this.#tasks];
            tasks[index] = task;
            this.#tasks = tasks;
        }
        this.#emitTasks();
        this.#emitUnfinishedCounts();
    }

    #deleteTask(id: string) {
        this.#tasks = this.#tasks.filter((task) => task.id !== id);
        this.#emitTasks();
        this.#emitUnfinishedCounts();
    }

    #emitTasks() {
        for (const listener of this.#listeners) {
            listener(this.#tasks);
        }
    }

    #emitUnfinishedCounts() {
        if (this.#listeners.size === 0) return;
        for (const listener of this.#countListeners) {
            listener(this.#getUnfinishedCount());
        }
    }
}

export default new TransferService();
