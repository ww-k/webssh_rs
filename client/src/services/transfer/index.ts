import { nanoid } from "nanoid";
import QueueService from "simple-queue-serve";

import { getFileName, parseSftpUri } from "@/helpers/file_uri";
import fileSave from "@/helpers/fileSave";
import openNativeFileSelector from "@/helpers/openNativeFileSelector";

import download from "./download";
import useTransferStore from "./store";
import TransferError from "./TransferError";
import upload from "./upload";

import type { ITransferRange } from "./types";

interface IUploadOption {
    file: File;
    fileUri: string;
}

interface IPrivateUploadOption extends IUploadOption {
    ranges?: ITransferRange[];
}

interface IPrivateDownloadOption {
    fileUri: string;
    size?: number;
    ranges?: ITransferRange[];
}

class TransferService {
    /** 传输任务队列服务 */
    #queue = new QueueService({
        concurrency: 1,
    });
    /** 传输任务函数 */
    #queueTaskMap = new Map<string, () => Promise<void>>();
    /** 运行中的传输任务的AbortController */
    #abortCtrlMap = new Map<string, AbortController>();
    /** 缓存上传文件 */
    #fileMap = new Map<string, File>();
    /** 缓存下载文件内容 */
    #blobsMap = new Map<string, Blob[]>();

    setConfig(option: {
        /** 并发任务数 */
        concurrency?: number;
        /** 每个任务执行间的间隔 */
        interval?: number;
    }) {
        this.#queue.setConfig(option);
    }

    async upload(option: IUploadOption) {
        const uri = parseSftpUri(option.fileUri);
        if (!uri) {
            throw new TransferError({
                code: "InvalidUri",
                message: "InvalidUri",
            });
        }
        const id = nanoid();
        useTransferStore.getState().add({
            id,
            type: "UPLOAD",
            status: "WAIT",
            targetId: uri.targetId,
            targetUri: option.fileUri,
            targetPath: uri.path,
            localPath: option.file.name,
            name: option.file.name,
            size: option.file.size,
            loaded: 0,
        });
        await this.#upload(id, option);
    }

    async #upload(id: string, option: IPrivateUploadOption) {
        return await new Promise<void>((resolve, reject) => {
            const queueTask = this.#uploadTaskFn.bind(
                this,
                id,
                option,
                resolve,
                reject,
            );
            this.#queueTaskMap.set(id, queueTask);
            this.#fileMap.set(id, option.file);
            this.#queue.push(queueTask);
        });
    }

    async #uploadTaskFn(
        id: string,
        option: IPrivateUploadOption,
        resolve: () => void,
        reject: (reason?: unknown) => void,
    ) {
        useTransferStore.getState().setRun(id);

        const abortController = new AbortController();
        this.#abortCtrlMap.set(id, abortController);

        abortController.signal.addEventListener("abort", () => {
            reject(
                new TransferError({
                    code: "Aborted",
                    message: "Aborted",
                }),
            );
        });

        try {
            await upload({
                ...option,
                signal: abortController.signal,
                onProgress: (progress) => {
                    useTransferStore.getState().updateProgress(id, progress);
                },
            });

            useTransferStore.getState().setSuccess(id);
            resolve();
        } catch (err) {
            const failReason =
                err instanceof TransferError ? err.message : "Unknown";
            useTransferStore.getState().setFail(id, failReason);
            reject(err);
        }

        this.#abortCtrlMap.delete(id);
        this.#fileMap.delete(id);
        this.#queueTaskMap.delete(id);
    }

    async download(option: { fileUri: string; size?: number }) {
        const uri = parseSftpUri(option.fileUri);
        if (!uri) {
            throw new TransferError({
                code: "InvalidUri",
                message: "InvalidUri",
            });
        }
        const name = getFileName(option.fileUri);
        const id = nanoid();
        useTransferStore.getState().add({
            id,
            type: "DOWNLOAD",
            status: "WAIT",
            targetId: uri.targetId,
            targetUri: option.fileUri,
            targetPath: uri.path,
            localPath: name,
            name,
            loaded: 0,
            size: option.size,
        });
        return await this.#download(id, name, option);
    }

    async #download(id: string, name: string, option: IPrivateDownloadOption) {
        return await new Promise<void>((resolve, reject) => {
            const queueTask = this.#downloadTaskFn.bind(
                this,
                id,
                name,
                option,
                resolve,
                reject,
            );
            this.#queueTaskMap.set(id, queueTask);
            this.#queue.push(queueTask);
        });
    }

    async #downloadTaskFn(
        id: string,
        name: string,
        option: IPrivateDownloadOption,
        resolve: () => void,
        reject: (reason?: unknown) => void,
    ) {
        let blobs = this.#blobsMap.get(id);
        if (!blobs) {
            blobs = [];
            this.#blobsMap.set(id, blobs);
        }
        useTransferStore.getState().setRun(id);

        const abortController = new AbortController();
        this.#abortCtrlMap.set(id, abortController);

        abortController.signal.addEventListener("abort", () => {
            reject(
                new TransferError({
                    code: "Aborted",
                    message: "Aborted",
                }),
            );
        });

        try {
            await download({
                ...option,
                blobs,
                signal: abortController.signal,
                onProgress: (progress) => {
                    useTransferStore.getState().updateProgress(id, progress);
                },
            });

            useTransferStore.getState().setSuccess(id);

            fileSave(
                new File(blobs, name, {
                    type: "application/octet-stream",
                }),
            );
            resolve();
        } catch (err) {
            const failReason =
                err instanceof TransferError ? err.message : "Unknown";
            useTransferStore.getState().setFail(id, failReason);
            reject(err);
        }

        this.#abortCtrlMap.delete(id);
        this.#blobsMap.delete(id);
        this.#queueTaskMap.delete(id);
    }

    #abort(id: string) {
        this.#abortCtrlMap.get(id)?.abort();
        this.#abortCtrlMap.delete(id);
        this.#queueTaskMap.delete(id);
    }

    pause(id: string) {
        const queueTask = this.#queueTaskMap.get(id);
        if (queueTask) {
            useTransferStore.getState().setPause(id);
            this.#queue.remove(queueTask);
        }
        this.#abort(id);
    }

    async resume(id: string) {
        const record = useTransferStore.getState().get(id);
        if (!record) {
            throw new TransferError("Record not found");
        }

        const fileUri = record.targetUri;
        if (record.type === "UPLOAD") {
            let file = this.#fileMap.get(id);
            if (!file) {
                const files = await openNativeFileSelector();
                file = files[0];
            }
            if (record.size !== file.size) {
                throw new TransferError("File size changed");
            }
            await this.#upload(id, {
                file,
                fileUri,
                ranges: record.missedRanges,
            });
        } else {
            return await this.#download(id, record.name, {
                fileUri,
                size: record.size,
                ranges: record.missedRanges,
            });
        }
    }

    remove(id: string) {
        const queueTask = this.#queueTaskMap.get(id);
        if (queueTask) {
            useTransferStore.getState().delete(id);
            this.#queue.remove(queueTask);
        }
        this.#abort(id);
        this.#fileMap.delete(id);
        this.#blobsMap.delete(id);
    }

    pauseAll() {}

    resumeAll() {}

    removeAll() {}
}

export default new TransferService();
