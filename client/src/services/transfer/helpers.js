/**
 * 根据待传输的文件范围，计算已传输的大小
 * @param {[number, number][]} ranges 待传输的文件范围
 * @param {number} totalSize 文件总大小
 * @returns {number}
 */
export function initLoadedSize(ranges, totalSize) {
    return ranges.reduce((loaded, range) => loaded - (range[1] - range[0] + 1), totalSize);
}

/**
 * 将待传输的文件范围，按分片大小，分割为小的文件范围列表
 * @param {[number, number][]} ranges 待传输的文件范围
 * @param {number} sliceSize 分片大小
 * @returns {[number, number][]}
 */
export function initRanges(ranges, sliceSize) {
    const newRanges = [];
    for (let i = 0; i < ranges.length; i++) {
        const range = ranges[i];
        const rangeSize = range[1] - range[0] + 1;
        const sliceNum = Math.ceil(rangeSize / sliceSize);
        const lastEnd = range[1];
        let start, end;
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
