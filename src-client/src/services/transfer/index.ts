import {
    deleteTransferTask,
    getTransferTask,
    getTransferTasks,
    postTransferCancel,
    postTransferDownload,
    postTransferPause,
    postTransferResume,
    postTransferUpload,
} from "@/api";
import { getFileName, parseSftpUri } from "@/helpers/file_uri";

import useTransferStore, { type ITransferListItem } from "./store";
import TransferError from "./TransferError";

import type { ITransferTask } from "@/api";

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
    #pollTimerMap = new Map<string, number>();

    setConfig(_option: {
        /** 并发任务数 */
        concurrency?: number;
        /** 每个任务执行间的间隔 */
        interval?: number;
    }) {}

    async upload(option: IUploadOption) {
        const task = await postTransferUpload({
            local_path: option.localPath,
            target_uri: option.fileUri,
        });
        this.#upsertTask(task);
        this.#poll(task.id);
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
        this.#poll(task.id);
        return task;
    }

    async syncTasks() {
        const tasks = await getTransferTasks();
        tasks.forEach((task) => {
            this.#upsertTask(task);
            if (["WAIT", "RUN"].includes(task.status)) {
                this.#poll(task.id);
            }
        });
    }

    async pause(id: string) {
        const task = await postTransferPause(id);
        this.#clearPoll(id);
        this.#upsertTask(task);
    }

    async resume(id: string) {
        const task = await postTransferResume(id);
        this.#upsertTask(task);
        this.#poll(id);
    }

    async remove(id: string) {
        const record = useTransferStore.getState().get(id);
        this.#clearPoll(id);
        if (record && ["WAIT", "RUN", "PAUSE"].includes(record.status)) {
            try {
                const task = await postTransferCancel(id);
                this.#upsertTask(task);
            } catch (err) {
                console.warn("TransferService.remove cancel failed", err);
            }
        }
        await deleteTransferTask(id);
        useTransferStore.getState().delete(id);
    }

    pauseAll() {}

    resumeAll() {}

    removeAll() {}

    #poll(id: string) {
        this.#clearPoll(id);

        const pollOnce = async () => {
            try {
                const task = await getTransferTask(id);
                this.#upsertTask(task);
                if (["SUCCESS", "FAIL", "CANCEL", "PAUSE"].includes(task.status)) {
                    this.#clearPoll(id);
                }
            } catch (err) {
                this.#clearPoll(id);
                const failReason =
                    err instanceof TransferError ? err.message : "Unknown";
                useTransferStore.getState().setFail(id, failReason);
            }
        };

        const timer = window.setInterval(pollOnce, 1000);
        this.#pollTimerMap.set(id, timer);
        pollOnce();
    }

    #clearPoll(id: string) {
        const timer = this.#pollTimerMap.get(id);
        if (timer) {
            window.clearInterval(timer);
            this.#pollTimerMap.delete(id);
        }
    }

    #upsertTask(task: ITransferTask) {
        const item = this.#toStoreItem(task);
        const store = useTransferStore.getState();
        if (store.get(item.id)) {
            store.update(item.id, item);
        } else {
            store.add(item);
        }
    }

    #toStoreItem(task: ITransferTask): ITransferListItem {
        const targetUri = task.target_uri || task.source_uri || "";
        const uri = parseSftpUri(targetUri);
        const targetPath = uri?.path || "";

        return {
            id: task.id,
            type: task.type,
            status: task.status,
            createdAt: task.created_at,
            targetId: task.target_id || uri?.targetId || 0,
            targetUri,
            targetPath,
            localPath: task.local_path || "",
            name: task.name || getFileName(targetUri),
            loaded: task.loaded,
            size: task.total,
            percent: task.percent,
            missedRanges: task.ranges,
            speed: task.speed,
            estimatedTime: task.estimated_time,
            failReason: task.fail_reason,
            endDate: task.ended_at,
        };
    }
}

export default new TransferService();
