import simpleQueueRun from "@/helpers/simple_queue_run";

import { initLoadedSize, initRanges } from "../helpers";
import sliceUploader from "./sliceUploader";

import type { IFileUploadOption } from "../types";

export default async function uploadFile(option: IFileUploadOption) {
    const { fileUri, file, signal, interval, onProgress, onFlow } = option;

    let ranges = option.ranges;
    let loaded = 0;
    const _totalSize = file.size;

    const sliceSize = 1048576;

    if (ranges && _totalSize) {
        loaded = initLoadedSize(ranges, _totalSize);
    } else {
        ranges = [[0, _totalSize - 1]];
    }

    ranges = initRanges(ranges, sliceSize);

    function onSliceUploadDone(start: number, end: number) {
        if (signal.aborted) return false;

        loaded += end - start + 1;
        onProgress?.({
            range: [start, end],
            percent: (loaded * 100) / _totalSize,
            total: _totalSize,
            loaded,
        });
    }

    const tasksQueue = ranges.map((range) => {
        const [start, end] = range;
        return sliceUploader.bind(null, {
            fileUri,
            start,
            end,
            totalSize: _totalSize,
            file,
            signal,
            onFlow,
            onDone: onSliceUploadDone.bind(null, start, end),
        });
    });

    await simpleQueueRun(tasksQueue, {
        concurrence: 5,
        signal,
        interval,
    });

    return true;
}
