import {
    deleteTransferBatch,
    deleteTransferHistory,
    deleteTransferTask,
    getTransferTasks,
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
const SYNC_INTERVAL = 1000;

type TransferTasksListener = (tasks: ITransferTask[]) => void;

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
    #syncing = false;
    #tasks: ITransferTask[] = [];
    #listeners = new Set<TransferTasksListener>();

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
        this.#ensureSyncTimer();
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
        this.#ensureSyncTimer();
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
        this.#ensureSyncTimer();
        return batch;
    }
    async cancelBatch(id: string) {
        const batch = await postTransferBatchCancel(id);
        await this.syncTasks();
        return batch;
    }

    subscribe(listener: TransferTasksListener) {
        this.#listeners.add(listener);
        listener(this.#tasks);
        this.syncTasks().catch((err) => {
            console.warn("TransferService.syncTasks failed", err);
        });

        return () => {
            this.#listeners.delete(listener);
            if (this.#listeners.size === 0) {
                this.#clearSyncTimer();
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
        this.#ensureSyncTimer(task);
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
        this.#ensureSyncTimer(task);
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
        this.#ensureSyncTimer(task);
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
    }

    async removeBatch(id: string) {
        await deleteTransferBatch(id);
        await this.syncTasks();
    }

    #ensureSyncTimer(task?: ITransferTask) {
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

    #setTasks(tasks: ITransferTask[]) {
        this.#tasks = tasks;
        this.#emitTasks();
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
    }

    #deleteTask(id: string) {
        this.#tasks = this.#tasks.filter((task) => task.id !== id);
        this.#emitTasks();
    }

    #emitTasks() {
        for (const listener of this.#listeners) {
            listener(this.#tasks);
        }
    }
}

export default new TransferService();
