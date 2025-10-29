import { postSftpUpload } from "@/api";
import PromiseWithResolvers from "@/helpers/PromiseWithResolvers";
import { updateMissedRange } from "@/helpers/ranges";
import SpeedCounter from "@/helpers/speed_counter";

import { sumRangesSize } from "../helpers";
import TransferError from "../TransferError";
import uploadFile from "./uploadFile";

import type { ITransferProgressEvent, ITransferRange } from "../types";

interface IUploadTaskOption {
    file: File;
    fileUri: string;
    signal: AbortSignal;
    ranges?: ITransferRange[];
    onProgress?: (progress: ITransferProgressEvent) => void;
}

export default async function upload({
    file,
    fileUri,
    signal,
    ranges,
    onProgress,
}: IUploadTaskOption): Promise<void> {
    const { promise, resolve, reject } = PromiseWithResolvers<void>();

    const fileSize = file.size;
    let unLoaded = fileSize;
    let lastLoaded = 0;

    if (ranges) {
        unLoaded = sumRangesSize(ranges);
    }

    if (fileSize && fileSize > unLoaded) {
        lastLoaded = fileSize - unLoaded;
    }

    const progress: ITransferProgressEvent = {
        percent: fileSize ? (lastLoaded / fileSize) * 100 : 0,
        total: fileSize,
        loaded: lastLoaded,
        speed: 0,
        estimatedTime: Infinity,
        missedRanges: ranges,
    };

    const speedCounter = SpeedCounter();
    speedCounter.start();

    let retryTimer: number | undefined;
    let ended = false;
    let abortController: AbortController;

    signal.addEventListener("abort", abort);
    start();

    async function start() {
        abortController = new AbortController();

        if (fileSize === 0) {
            touchFile();
            return;
        }

        if (unLoaded === 0) {
            handleDone();
            return;
        }

        let sumLoaded = 0;

        speedCounter.onRecordTimeup((record) => {
            if (isEnd()) return;

            record(sumLoaded);
            sumLoaded = 0;
            handleProgress(progress);
        });

        try {
            await uploadFile({
                file,
                fileUri,
                signal: abortController.signal,
                ranges,
                onFlow: (newLoaded) => {
                    sumLoaded += newLoaded;
                },
                onProgress: (progress1) => {
                    console.debug("Transfer/upload onProgress", progress1);
                    handleProgress(progress1);
                },
            });
            handleDone();
        } catch (err) {
            abortController?.abort();
            handleError(err);
        }
    }

    function abort() {
        abortController?.abort();
        dispose();
    }

    function dispose() {
        clearTimeout(retryTimer);
        speedCounter.end();
        ended = true;
    }

    function isEnd() {
        return ended;
    }

    function touchFile() {
        postSftpUpload(fileUri, "")
            .then(() => handleDone())
            .catch((error) => handleError(error));
    }

    function handleProgress(progress1: {
        range?: ITransferRange;
        percent: number;
        total: number;
        loaded: number;
    }) {
        lastLoaded = progress1.loaded || 0;
        unLoaded = fileSize - lastLoaded;

        const speed = speedCounter.get();
        progress.speed = speed || 0;
        progress.estimatedTime =
            speed > 0 ? Math.round(unLoaded / speed) : Infinity;

        if (progress1.range) {
            progress.percent = progress1.percent;
            progress.total = progress1.total;
            progress.loaded = progress1.loaded;
            if (!progress.missedRanges) {
                progress.missedRanges = [[0, fileSize - 1]];
            }
            progress.missedRanges = updateMissedRange(
                progress.missedRanges,
                progress1.range,
            );
            if (unLoaded === 0) {
                // 上传完后，立即更新进度，优化进度条的视觉效果，尽量能看到进度到100%
                onProgress?.(progress);
            }
        } else {
            onProgress?.(progress);
        }
    }

    function handleDone() {
        if (isEnd()) return;

        dispose();
        resolve();
    }

    function handleError(error: unknown) {
        if (isEnd()) return;

        let err = error as TransferError;
        if (!(error instanceof TransferError)) {
            err = new TransferError(error);
        }
        if (canRetry(err)) {
            console.debug("Transfer/upload: transfer retry", error);
            handleRetry();
        } else {
            dispose();
            reject(err);
        }
    }

    function handleRetry() {
        if (isEnd()) return;

        retryTimer = setTimeout(() => {
            if (isEnd()) return;

            start();
        }, 500);
    }

    function canRetry(error: TransferError) {
        switch (error.code) {
            case "NetworkError":
                return true;
            default:
                return false;
        }
    }

    return await promise;
}
