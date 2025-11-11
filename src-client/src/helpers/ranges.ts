type IRange = [number, number];

/** 更新 missedRange */
export function updateMissedRange(
    missedRange: IRange[],
    receivedRange: IRange,
) {
    const newMissedRange: IRange[] = [...missedRange];
    let range: IRange, point1: number, point2: number;
    for (let i = 0, len = missedRange.length; i < len; i++) {
        range = missedRange[i];
        point1 = receivedRange[0] - range[0];
        point2 = range[1] - receivedRange[1];
        if (point1 >= 0 && point2 >= 0) {
            if (point1 === 0 && point2 === 0) {
                newMissedRange.splice(i, 1);
            } else if (point1 === 0) {
                newMissedRange.splice(i, 1, [receivedRange[1] + 1, range[1]]);
            } else if (point2 === 0) {
                newMissedRange.splice(i, 1, [range[0], receivedRange[0] - 1]);
            } else {
                newMissedRange.splice(
                    i,
                    1,
                    [range[0], receivedRange[0] - 1],
                    [receivedRange[1] + 1, range[1]],
                );
            }
            break;
        }
    }
    return newMissedRange;
}

/** 格式化 ranges */
export function formartMissedRange(ranges: IRange[]) {
    return ranges.map((range) => `${range[0]}-${range[1]}`).join();
}
