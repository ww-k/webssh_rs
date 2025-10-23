import type { ITransferRange } from "./types";

/**
 * 根据待传输的文件范围，计算已传输的大小
 * @param ranges 待传输的文件范围
 * @param fileSize 文件总大小
 */
export function initLoadedSize(ranges: ITransferRange[], fileSize: number) {
    const unloaded = sumRangesSize(ranges);
    return fileSize - unloaded;
}

/**
 * 根据待传输的文件范围，计算文件范围的总大小
 * @param ranges 文件范围
 */
export function sumRangesSize(ranges: ITransferRange[]) {
    return ranges.reduce((sum, curVal) => sum + curVal[1] - curVal[0] + 1, 0);
}

/**
 * 将待传输的文件范围，按分片大小，分割为小的文件范围列表
 * @param ranges 待传输的文件范围
 * @param sliceSize 分片大小
 */
export function initRanges(ranges: ITransferRange[], sliceSize: number) {
    const newRanges: ITransferRange[] = [];
    for (let i = 0; i < ranges.length; i++) {
        const range = ranges[i];
        const rangeSize = range[1] - range[0] + 1;
        const sliceNum = Math.ceil(rangeSize / sliceSize);
        const lastEnd = range[1];
        let start = 0;
        let end = 0;
        let j = 0;

        while (j < sliceNum) {
            start = j * sliceSize + range[0];
            end = Math.min((j + 1) * sliceSize - 1 + range[0], lastEnd);
            newRanges.push([start, end]);

            j++;
        }
    }

    // @ts-ignore
    return newRanges;
}
