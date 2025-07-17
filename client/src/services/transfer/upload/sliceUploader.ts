import { postSftpUpload } from "@/api";
import calcHashHex from "@/helpers/calcHashHex";

import type { ISliceLoadOption } from "../types";

export default async function sliceUploader(option: ISliceLoadOption) {
    const { fileUri, file, start, end, totalSize, signal, onFlow, onDone } =
        option;

    if (!file) return;

    console.debug(`Transfer/upload: sliceUploader start`, start);

    const fileSlice = file.slice(start, end + 1);
    let preLoaded = 0;

    const [expectHash, responseHash] = await Promise.all([
        calcHashHex(fileSlice),
        postSftpUpload(fileUri, fileSlice, {
            start,
            end,
            size: totalSize,
            signal,
            onUploadProgress: (progressEvent) => {
                onFlow?.(progressEvent.loaded - preLoaded);
                preLoaded = progressEvent.loaded;
            },
        }).then((response) => response.hash),
    ]);

    if (expectHash !== responseHash) {
        throw new Error(
            `response Hash ${responseHash} not match upload Hash ${expectHash}`,
        );
    }

    onDone?.();

    console.debug(`Transfer/upload: sliceUploader end`, option.start);

    return;
}
