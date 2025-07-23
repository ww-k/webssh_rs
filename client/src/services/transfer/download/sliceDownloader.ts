import { getSftpDownload } from "@/api";

import type { ISliceDownloadOption } from "../types";

export default async function sliceDownloader(option: ISliceDownloadOption) {
    const { fileUri, start, end, signal, onFlow, onDone } = option;

    console.debug(`Transfer/download: sliceDownloader start`, start);

    if (signal.aborted) return false;

    let preLoaded = 0;

    const response = await getSftpDownload(fileUri, {
        silence: true,
        signal,
        start,
        end,
        onDownloadProgress: (progressEvent) => {
            onFlow?.(progressEvent.loaded - preLoaded);
            preLoaded = progressEvent.loaded;
        },
    });

    if (signal.aborted) return false;

    onDone?.(response);

    console.debug(`Transfer/download: sliceDownloader end`, option.start);

    return response;
}
