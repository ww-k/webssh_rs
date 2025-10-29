import { rs } from "@rstest/core";

import calcHashHex from "@/helpers/calcHashHex";

import { initRanges, sumeBlobsSize } from "./helpers";

import type { AxiosProgressEvent, GenericAbortSignal } from "axios";
import type { ISftpFileStat } from "@/api";
import type { ITransferRange } from "./types";

function wait(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export const mockFileStat: Record<string, ISftpFileStat> = {
    "sftp:1:/Users/test1": {
        name: "test1",
        type: "f",
        size: 0,
        atime: 0,
        mtime: 0,
        permissions: "rwxr-xr-x",
    },
    "sftp:1:/Users/test2": {
        name: "test2",
        type: "f",
        size: 567,
        atime: 0,
        mtime: 0,
        permissions: "rwxr-xr-x",
    },
    "sftp:1:/Users/test3": {
        name: "test3",
        type: "f",
        size: 1024 * 1024 * 10 + 567,
        atime: 0,
        mtime: 0,
        permissions: "rwxr-xr-x",
    },
    "sftp:1:/Users/test4": {
        name: "test4",
        type: "f",
        size: 1024 * 1024 * 10 + 567,
        atime: 0,
        mtime: 0,
        permissions: "rwxr-xr-x",
    },
    "sftp:1:/Users/test5": {
        name: "test5",
        type: "f",
        size: 1024 * 1024 * 10 + 567,
        atime: 0,
        mtime: 0,
        permissions: "rwxr-xr-x",
    },
};

export const mockFs: Record<string, File> = {};

export const tempUploadBlobs: Record<string, Blob[]> = {};

export function clearMockFs() {
    Object.keys(mockFs).forEach((key) => {
        delete mockFs[key];
    });
}

export function clearTempUploadBlobs() {
    Object.keys(tempUploadBlobs).forEach((key) => {
        delete tempUploadBlobs[key];
    });
}

export function sumUploadBlobsSize(fileUri: string) {
    const blobs = tempUploadBlobs[fileUri];
    if (!blobs) return 0;
    return sumeBlobsSize(blobs);
}

export const fileSave = rs.fn((data: File) => {
    const fileName = data.name;
    const stat = mockFileStat[`sftp:1:/Users/${fileName}`];
    if (stat.size !== data.size) {
        throw new Error("file size error");
    }
    mockFs[fileName] = data;
    return null;
});

export const getSftpStat = rs.fn(async (uri: string) => {
    await wait(10);
    return mockFileStat[uri];
});

export const getSftpDownload = rs.fn(
    async (
        _fileUri: string,
        option?: {
            start?: number;
            end?: number;
            responseType?: ResponseType;
            /** 是否静默请求。如果是，则接口报错也不弹出通知框 */
            silence?: boolean;
            onDownloadProgress?: (progressEvent: AxiosProgressEvent) => void;
            signal?: GenericAbortSignal;
        },
    ) => {
        await wait(10);

        if (option) {
            if (
                typeof option.start === "number" &&
                typeof option.end === "number"
            ) {
                const arrBuf = generateMockFileSlice(option.start, option.end);
                return new Blob([arrBuf]);
            }
        }

        throw new Error("getSftpDownload error");
    },
);

export const postSftpUpload = rs.fn(
    async (
        fileUri: string,
        fileSlice: Blob | string,
        option?: {
            start?: number;
            end?: number;
            /** 文件总大小, 非分片大小 */
            size?: number;
            signal?: GenericAbortSignal;
        },
    ) => {
        let blobs = tempUploadBlobs[fileUri];
        if (!blobs) {
            blobs = [];
            tempUploadBlobs[fileUri] = blobs;
        }
        if (option) {
            if (
                typeof option.start === "number" &&
                typeof option.end === "number" &&
                fileSlice instanceof Blob
            ) {
                const sliceSize = 1048576;
                const index = option.start / sliceSize;
                blobs[index] = fileSlice;
                const hash = await calcHashHex(fileSlice);
                return { hash };
            }
        }
        if (!option && fileSlice === "") {
            const hash = await calcHashHex(new Blob());
            return { hash };
        }

        throw new Error("postSftpUpload error");
    },
);

export function generateMockFileSlice(start: number, end: number) {
    const size = end - start + 1;
    const arrBuf = new ArrayBuffer(size);
    const view = new DataView(arrBuf);
    if (size >= 8) {
        view.setUint32(0, start);
        view.setUint32(arrBuf.byteLength - 4, end);
    } else if (size >= 4) {
        view.setUint32(0, start);
    }
    return arrBuf;
    // const strArr = [];
    // let startStr = `${start}`;
    // let endStr = `${end}`;
    // let startAndEndSize = startStr.length + endStr.length;

    // if (size < startStr.length) {
    //     startStr = "";
    //     endStr = "";
    // } else if (size < startAndEndSize) {
    //     endStr = "";
    //     startAndEndSize = startStr.length;
    // }

    // startAndEndSize = startStr.length + endStr.length;

    // strArr.push(startStr);
    // for (let i = startAndEndSize; i < size; i++) {
    //     strArr.push("-");
    // }
    // strArr.push(endStr);

    // return new Blob(strArr);
}

export function generateMockFile(fileName: string) {
    const stat = mockFileStat[`sftp:1:/Users/${fileName}`];
    if (!stat) throw new Error("file not in mockFileStat");

    const sliceSize = 1048576;
    let ranges: ITransferRange[] = [[0, stat.size - 1]];
    ranges = initRanges(ranges, sliceSize);

    const arrBufs = ranges.map((range) => {
        const [start, end] = range;
        return generateMockFileSlice(start, end);
    });

    return new File(arrBufs, fileName);
}
