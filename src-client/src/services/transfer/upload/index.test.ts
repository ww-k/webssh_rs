import { afterAll, expect, rs, test } from "@rstest/core";

import TransferError from "../TransferError";
import {
    clearTempUploadBlobs,
    generateMockFile,
    mockFileStat,
    postSftpUpload,
    sumUploadBlobsSize,
} from "../test_helpers";
import upload from ".";

afterAll(async () => {
    clearTempUploadBlobs();
});

let postSftpUploadSucess = true;
let postSftpUploadFail = false;
let networkErrorCount = 0;
rs.mock("@/api", () => ({
    postSftpUpload: async (
        fileUri: string,
        fileSlice: Blob | string,
        // biome-ignore lint/suspicious/noExplicitAny: yes
        option?: any,
    ) => {
        if (postSftpUploadSucess) {
            return postSftpUpload(fileUri, fileSlice, option);
        } else if (postSftpUploadFail) {
            throw new Error("upload failed");
        } else {
            networkErrorCount++;
            throw {
                code: "NetworkError",
                message: "shold retry",
            };
        }
    },
}));

test("[TransferUpload] upload success", async () => {
    const abortController = new AbortController();

    let fileName = "test1";
    let fileUri = `sftp:1:/Users/${fileName}`;
    let file = generateMockFile(fileName);
    await upload({
        fileUri,
        file,
        signal: abortController.signal,
    });
    expect(sumUploadBlobsSize(fileUri)).toBe(mockFileStat[fileUri].size);

    fileName = "test2";
    fileUri = `sftp:1:/Users/${fileName}`;
    file = generateMockFile(fileName);
    await upload({
        fileUri,
        file,
        signal: abortController.signal,
    });
    expect(sumUploadBlobsSize(fileUri)).toBe(mockFileStat[fileUri].size);

    fileName = "test3";
    fileUri = `sftp:1:/Users/${fileName}`;
    file = generateMockFile(fileName);
    await upload({
        fileUri,
        file,
        signal: abortController.signal,
    });
    expect(sumUploadBlobsSize(fileUri)).toBe(mockFileStat[fileUri].size);
}, 10000);

test("[TransferUpload] upload fail", async () => {
    postSftpUploadSucess = false;
    postSftpUploadFail = true;

    const abortController = new AbortController();
    const fileName = "test2";
    const fileUri = `sftp:1:/Users/${fileName}`;
    const file = generateMockFile(fileName);
    try {
        await upload({
            fileUri,
            file,
            signal: abortController.signal,
        });
    } catch (err: unknown) {
        expect(err).toBeInstanceOf(TransferError);
    }
});

test("[TransferUpload] upload error and retry", async () => {
    postSftpUploadSucess = false;
    postSftpUploadFail = false;
    const abortController = new AbortController();
    const fileName = "test2";
    const fileUri = `sftp:1:/Users/${fileName}`;
    const file = generateMockFile(fileName);

    setTimeout(() => {
        postSftpUploadSucess = true;
    }, 5000);

    await upload({
        fileUri,
        file,
        signal: abortController.signal,
    });

    expect(networkErrorCount).toBeGreaterThan(9);
}, 6000);
