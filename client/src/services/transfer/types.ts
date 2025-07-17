export interface ITransferProgressEvent {
    percent: number;
    total: number;
    loaded: number;
    missedRanges: [number, number][];
    speed?: number;
    estimatedTime?: number;
}

/** 分片传输器配置项 */
export interface ISliceLoadOption {
    /** 文件远端uri */
    fileUri: string;
    /** 分片开始点 */
    start: number;
    /** 分片结束点 */
    end: number;
    /** 偏移量，例如海信加解密，下载的文件内容前会附加一个加密头 */
    offset?: number;
    /** AbortSignal, 用于终止传输 */
    signal: AbortSignal;
    /** 调用下载接口的响应类型 */
    responseType?: "blob" | "stream";
    /** 是否启用下载校验, 仅客户端下载支持 */
    strictDownload?: boolean;
    /** 浏览器上传的文件对象 */
    file: Blob;
    /** 文件总大小, 仅上传需要 */
    totalSize?: number;
    /** 流量更新事件，传递距离上次通知的时间段内，新增的流量 */
    onFlow?: (loaded: number) => void;
    /** 分片传输完成事件, 浏览器下载会额外传递下载结果blob, 客户端下载会传递可读流 */
    onDone?: (blob?: Blob) => void;
}

export interface IFileLoadOption {
    /** 文件远端uri */
    fileUri: string;
    /** 浏览器上传的文件对象 */
    file: File;
    /** 文件总大小 */
    totalSize?: number;
    /** AbortSignal, 用于终止传输 */
    signal: AbortSignal;
    /** 每个任务执行间的间隔 */
    interval?: number;
    /** 传输的文件范围 */
    ranges?: [number, number][];
    /** 仅浏览器下载支持，已下载完成的blob列表 */
    blobs?: Blob[];
    /** 是否启用下载校验, 仅客户端下载支持 */
    strictDownload?: boolean;
    /** 传输进度更新事件, 有分片传输完成时触发 */
    onProgress?: (evt: {
        range: [number, number];
        percent: number;
        total: number;
        loaded: number;
    }) => void;
    /** 流量更新事件，距离上次通知的时间段内，新增的流量 */
    onFlow?: ISliceLoadOption["onFlow"];
    /** 文件大小变化事件，续传才需要 */
    onUpdateSize?: (option: {
        totalSize: number;
        ranges: [number, number][];
    }) => void;
}
