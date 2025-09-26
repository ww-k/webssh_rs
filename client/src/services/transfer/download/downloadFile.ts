import simpleQueueRun from "simple-queue-run";

import { getSftpStat } from "@/api";

import { initLoadedSize, initRanges } from "../helpers";
import sliceDownloader from "./sliceDownloader";

import type { IFileDownloadOption } from "../types";

export default async function downloadFile(option: IFileDownloadOption) {
    const {
        fileUri,
        fileSize,
        signal,
        interval,
        blobs,
        onProgress,
        onFlow,
        onUpdateSize,
    } = option;
    const info = await getSftpStat(fileUri);

    console.debug(`Transfer/download: getSftpStat.`, info);

    if (signal.aborted) return false;

    let ranges = option.ranges;
    let loaded = 0;
    let _totalSize = fileSize || 0;
    let needUpdateSize = false;

    if (ranges && _totalSize) {
        loaded = initLoadedSize(ranges, _totalSize);
        if (info.size !== _totalSize) {
            if (loaded === 0) {
                // 非续传, 直接按最新的大小下载
                needUpdateSize = true;
            } else if (info.size > _totalSize) {
                // 续传, 非严格下载, 文件比下载时大, 继续下载原范围
                console.debug(
                    "Transfer/download: file size increased and continue download.",
                );
            }
        }
    } else {
        // 没有传入下载大小和范围, 按最新的大小下载
        needUpdateSize = true;
        _totalSize = info.size;
        ranges = [[0, _totalSize - 1]];
    }

    /** 已下载的blobs, 浏览器下载用 */
    const blobArr = blobs || [];
    const sliceSize = 1048576;

    if (needUpdateSize) {
        console.debug(
            `Transfer/download: updateSize. newTotalSize=${info.size} preTotalSize=${_totalSize}`,
            ranges,
        );

        onUpdateSize?.({
            totalSize: _totalSize,
            ranges,
        });
    }

    ranges = initRanges(ranges, sliceSize);

    function onSliceDownloadDone(start: number, end: number, blob: Blob) {
        if (signal.aborted) return false;

        loaded += end - start + 1;
        if (blob instanceof Blob) {
            const index = start / sliceSize;
            if (blobArr[index]) {
                console.debug(
                    `Transfer/download: onSliceDownloadDone. blobArr[${index}] exists. start=${start} index=${index} `,
                );
            } else {
                console.debug(
                    `Transfer/download: onSliceDownloadDone. start=${start} index=${index}`,
                );
            }
            blobArr[index] = blob;
        }
        onProgress?.({
            range: [start, end],
            percent: (loaded * 100) / _totalSize,
            total: _totalSize,
            loaded,
        });
    }

    const tasksQueue = ranges.map((range) => {
        const [start, end] = range;
        return sliceDownloader.bind(null, {
            fileUri,
            start,
            end,
            totalSize: _totalSize,
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

    if (blobArr.length > 0) {
        return new Blob(blobArr);
    }

    return true;
}
