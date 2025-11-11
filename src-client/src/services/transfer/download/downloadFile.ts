import simpleQueueRun from "simple-queue-run";

import { initLoadedSize, initRanges } from "../helpers";
import sliceDownloader from "./sliceDownloader";

import type { IFileDownloadOption } from "../types";

export default async function downloadFile(option: IFileDownloadOption) {
    const {
        fileUri,
        fileSize = 0,
        blobs,
        signal,
        interval,
        onProgress,
        onFlow,
    } = option;

    if (!fileSize) {
        throw new Error("missing fileSize");
    }

    let ranges = option.ranges;
    let loaded = 0;

    if (ranges && fileSize) {
        loaded = initLoadedSize(ranges, fileSize);
    } else {
        ranges = [[0, fileSize - 1]];
    }

    const sliceSize = 1048576;

    ranges = initRanges(ranges, sliceSize);

    function onSliceDownloadDone(start: number, end: number, blob: Blob) {
        if (signal.aborted) return false;

        loaded += end - start + 1;
        if (blob instanceof Blob) {
            const index = start / sliceSize;
            if (blobs[index]) {
                console.debug(
                    `Transfer/download: onSliceDownloadDone. blobs[${index}] exists. start=${start} index=${index} `,
                );
            } else {
                console.debug(
                    `Transfer/download: onSliceDownloadDone. start=${start} index=${index}`,
                );
            }
            blobs[index] = blob;
        }
        onProgress?.({
            range: [start, end],
            percent: (loaded * 100) / fileSize,
            total: fileSize,
            loaded,
        });
    }

    const tasksQueue = ranges.map((range) => {
        const [start, end] = range;
        return sliceDownloader.bind(null, {
            fileUri,
            start,
            end,
            fileSize,
            signal,
            onFlow,
            onDone: onSliceDownloadDone.bind(null, start, end),
        });
    });

    await simpleQueueRun(tasksQueue, {
        concurrence: 5,
        signal,
        interval,
    });

    if (blobs.length > 0) {
        return blobs;
    }

    throw new Error("no blob");
}
