import { expect, rs, test } from "@rstest/core";

import { sumeBlobsSize } from "../helpers";
import TransferError from "../TransferError";
import { getSftpDownload, getSftpStat, mockFileStat } from "../test_helpers";
import download from ".";

let getSftpDownloadSucess = true;
let getSftpDownloadFail = false;
let networkErrorCount = 0;
rs.mock("@/api", () => ({
    getSftpStat: async (uri: string) => getSftpStat(uri),
    getSftpDownload: async (
        fileUri: string,
        // biome-ignore lint/suspicious/noExplicitAny: yes
        option?: any,
    ) => {
        if (getSftpDownloadSucess) {
            return getSftpDownload(fileUri, option);
        } else if (getSftpDownloadFail) {
            throw new Error("download failed");
        } else {
            networkErrorCount++;
            throw {
                code: "NetworkError",
                message: "shold retry",
            };
        }
    },
}));

test("[TransferDownload] download success", async () => {
    const abortController = new AbortController();
    const blobs: Blob[] = [];
    const sliceSize = 1048576;

    let fileName = "test1";
    let fileUri = `sftp:1:/Users/${fileName}`;
    await download({
        fileUri,
        signal: abortController.signal,
        blobs,
    });
    expect(sumeBlobsSize(blobs)).toBe(mockFileStat[fileUri].size);

    fileName = "test2";
    fileUri = `sftp:1:/Users/${fileName}`;
    blobs.length = 0;
    await download({
        fileUri,
        signal: abortController.signal,
        blobs,
    });
    expect(sumeBlobsSize(blobs)).toBe(mockFileStat[fileUri].size);

    let arrBuf = await blobs[0].arrayBuffer();
    let view = new DataView(arrBuf);
    expect(view.getUint32(0)).toBe(0);
    expect(view.getUint32(mockFileStat[fileUri].size - 4)).toBe(566);

    fileName = "test3";
    fileUri = `sftp:1:/Users/${fileName}`;
    blobs.length = 0;
    await download({
        fileUri,
        signal: abortController.signal,
        blobs,
    });
    expect(sumeBlobsSize(blobs)).toBe(mockFileStat[fileUri].size);

    arrBuf = await blobs[0].arrayBuffer();
    view = new DataView(arrBuf);
    expect(view.getUint32(0)).toBe(0);
    expect(view.getUint32(sliceSize - 4)).toBe(sliceSize - 1);

    arrBuf = await blobs[1].arrayBuffer();
    view = new DataView(arrBuf);
    expect(view.getUint32(0)).toBe(sliceSize);
    expect(view.getUint32(sliceSize - 4)).toBe(2 * sliceSize - 1);
}, 10000);

test("[TransferDownload] download fail", async () => {
    getSftpDownloadSucess = false;
    getSftpDownloadFail = true;

    const abortController = new AbortController();
    const fileName = "test2";
    const fileUri = `sftp:1:/Users/${fileName}`;
    try {
        await download({
            fileUri,
            signal: abortController.signal,
        });
    } catch (err: unknown) {
        expect(err).toBeInstanceOf(TransferError);
    }
});

test("[TransferDownload] download error and retry", async () => {
    getSftpDownloadSucess = false;
    getSftpDownloadFail = false;
    const abortController = new AbortController();
    const fileName = "test2";
    const fileUri = `sftp:1:/Users/${fileName}`;

    setTimeout(() => {
        getSftpDownloadSucess = true;
    }, 5000);

    await download({
        fileUri,
        signal: abortController.signal,
    });

    expect(networkErrorCount).toBeGreaterThan(9);
}, 6000);
