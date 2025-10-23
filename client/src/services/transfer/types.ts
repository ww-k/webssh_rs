export type ITransferRange = [number, number];

export interface ITransferProgressEvent {
    percent: number;
    total: number;
    loaded: number;
    missedRanges?: ITransferRange[];
    speed?: number;
    estimatedTime?: number;
}

export interface ISliceLoadOption {
    /** 文件远端uri */
    fileUri: string;
    /** 分片开始点 */
    start: number;
    /** 分片结束点 */
    end: number;
    /** 文件总大小 */
    fileSize: number;
    /** AbortSignal, 用于终止传输 */
    signal: AbortSignal;
    /** 流量更新事件，传递距离上次通知的时间段内，新增的流量 */
    onFlow?: (loaded: number) => void;
}

export interface IFileLoadOption {
    /** 文件远端uri */
    fileUri: string;
    /** AbortSignal, 用于终止传输 */
    signal: AbortSignal;
    /** 每个任务执行间的间隔 */
    interval?: number;
    /** 文件大小，续传时需要传 */
    fileSize?: number;
    /** 传输的文件范围 */
    ranges?: ITransferRange[];
    /** 传输进度更新事件, 有分片传输完成时触发 */
    onProgress?: (evt: {
        range: ITransferRange;
        percent: number;
        total: number;
        loaded: number;
    }) => void;
    /** 流量更新事件，距离上次通知的时间段内，新增的流量 */
    onFlow?: ISliceUploadOption["onFlow"];
}

export type ISliceUploadOption = ISliceLoadOption & {
    /** 浏览器上传的文件对象 */
    file: Blob;
    /** 分片上传完成事件 */
    onDone?: () => void;
};

export type IFileUploadOption = IFileLoadOption & {
    /** 浏览器上传的文件对象 */
    file: File;
};

export type ISliceDownloadOption = ISliceLoadOption & {
    /** 分片下载完成事件 */
    onDone?: (blob: Blob) => void;
};

export type IFileDownloadOption = IFileLoadOption & {
    /** 已下载完成的blob列表 */
    blobs: Blob[];
};
