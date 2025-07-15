/** 流量格式化函数， 最大支持到PB */
export default function flowFormatter(val: number, nanStr?: string): string {
    nanStr = nanStr || 'N/A';
    if (typeof val !== "number") {
        return nanStr;
    }
    if (val < 1024) {
        return `${val.toFixed(0)}B`;
    } else if (val < 1048576) {
        return `${(val / 1024).toFixed(2)}KB`;
    } else if (val < 1073741824) {
        return `${(val / 1048576).toFixed(2)}MB`;
    } else if (val < 1099511627776) {
        return `${(val / 1073741824).toFixed(2)}GB`;
    } else if (val < 1125899906842624) {
        return `${(val / 1099511627776).toFixed(2)}TB`;
    } else {
        return `${(val / 1125899906842624).toFixed(2)}PB`;
    }
}