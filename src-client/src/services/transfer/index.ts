import {
    deleteTransferTask,
    getTransferTasks,
    postTransferCancel,
    postTransferDownload,
    postTransferPause,
    postTransferResume,
    postTransferUpload,
} from "@/api";

import type { ITransferTask } from "@/api";

const ACTIVE_STATUSES = new Set(["WAIT", "RUN"]);
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
}

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
        const task = await postTransferUpload({
            local_path: option.localPath,
            target_uri: option.fileUri,
        });
        this.#upsertTask(task);
        this.#ensureSyncTimer(task);
        return task;
    }

    async download(option: IDownloadOption) {
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

    removeAll() {}

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
