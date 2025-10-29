import { afterAll, expect, rs, test } from "@rstest/core";

import transferService from "./index";
import useTransferStore from "./store";
import {
    clearMockFs,
    clearTempUploadBlobs,
    fileSave,
    getSftpDownload,
    getSftpStat,
    mockFileStat,
    mockFs,
    postSftpUpload,
} from "./test_helpers";

rs.mock("@/api", () => ({
    getSftpStat: async (uri: string) => getSftpStat(uri),
    getSftpDownload: async (
        fileUri: string,
        // biome-ignore lint/suspicious/noExplicitAny: yes
        option?: any,
    ) => getSftpDownload(fileUri, option),
    postSftpUpload: async (
        fileUri: string,
        fileSlice: Blob | string,
        // biome-ignore lint/suspicious/noExplicitAny: yes
        option?: any,
    ) => postSftpUpload(fileUri, fileSlice, option),
}));

rs.mock("@/helpers/fileSave", () => {
    return {
        default: (data: File) => fileSave(data),
    };
});

afterAll(async () => {
    clearMockFs();
    clearTempUploadBlobs();
});

test("[TransferService] download one file", async () => {
    let state = useTransferStore.getState();

    let fileName = "test1";
    let fileUri = `sftp:1:/Users/${fileName}`;
    await transferService.download({
        fileUri,
    });
    state = useTransferStore.getState();
    expect(fileSave).toHaveBeenCalledWith(mockFs[fileName]);
    expect(mockFs[fileName].size).toBe(mockFileStat[fileUri].size);
    expect(state.list.length).toBe(1);
    expect(state.list[0]).toMatchObject({
        type: "DOWNLOAD",
        status: "SUCCESS",
        local: fileName,
        remote: fileUri,
        name: fileName,
        size: undefined,
    });

    fileName = "test2";
    fileUri = `sftp:1:/Users/${fileName}`;
    await transferService.download({
        fileUri,
        size: mockFileStat[fileUri].size,
    });
    state = useTransferStore.getState();
    expect(fileSave).toHaveBeenCalledWith(mockFs[fileName]);
    expect(mockFs[fileName].size).toBe(mockFileStat[fileUri].size);
    expect(state.list.length).toBe(2);
    expect(state.list[1]).toMatchObject({
        type: "DOWNLOAD",
        status: "SUCCESS",
        local: fileName,
        remote: fileUri,
        name: fileName,
        size: mockFileStat[fileUri].size,
    });
}, 10000);

test.todo("[TransferService] queue", async () => {}, 10000);
