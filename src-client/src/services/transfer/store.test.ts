import { expect, test } from "@rstest/core";
import { nanoid } from "nanoid";

import useTransferStore from "./store";

test("[TransferStore]", async () => {
    const id = nanoid();
    const state = useTransferStore.getState();
    state.add({
        id,
        type: "UPLOAD",
        status: "WAIT",
        localPath: "local",
        targetId: 1,
        targetPath: "/test1",
        targetUri: "sftp://1/test1",
        name: "name",
        size: 10,
        loaded: 0,
    });
    expect(state.get(id)).toEqual({
        id,
        type: "UPLOAD",
        status: "WAIT",
        localPath: "local",
        targetId: 1,
        targetPath: "/test1",
        targetUri: "sftp://1/test1",
        name: "name",
        size: 10,
        loaded: 0,
    });

    state.setRun(id);
    expect(state.get(id)).toEqual({
        id,
        type: "UPLOAD",
        status: "RUN",
        localPath: "local",
        targetId: 1,
        targetPath: "/test1",
        targetUri: "sftp://1/test1",
        name: "name",
        size: 10,
        loaded: 0,
    });

    state.updateProgress(id, {
        percent: 10,
        total: 10,
        loaded: 0,
        speed: 0,
        estimatedTime: Infinity,
        missedRanges: undefined,
    });
    expect(state.get(id)).toEqual({
        id,
        type: "UPLOAD",
        status: "RUN",
        localPath: "local",
        targetId: 1,
        targetPath: "/test1",
        targetUri: "sftp://1/test1",
        name: "name",
        size: 10,

        percent: 10,
        total: 10,
        loaded: 0,
        speed: 0,
        estimatedTime: Infinity,
        missedRanges: undefined,
    });

    state.updateProgress(id, {
        percent: 10,
        total: 10,
        loaded: 2,
        speed: 2,
        estimatedTime: 10,
        missedRanges: [[2, 9]],
    });
    expect(state.get(id)).toEqual({
        id,
        type: "UPLOAD",
        status: "RUN",
        localPath: "local",
        targetId: 1,
        targetPath: "/test1",
        targetUri: "sftp://1/test1",
        name: "name",
        size: 10,

        percent: 10,
        total: 10,
        loaded: 2,
        speed: 2,
        estimatedTime: 10,
        missedRanges: [[2, 9]],
    });

    state.updateProgress(id, {
        percent: 10,
        total: 10,
        loaded: 2,
        speed: 2,
        estimatedTime: 10,
        missedRanges: undefined,
    });
    expect(state.get(id)).toEqual({
        id,
        type: "UPLOAD",
        status: "RUN",
        localPath: "local",
        targetId: 1,
        targetPath: "/test1",
        targetUri: "sftp://1/test1",
        name: "name",
        size: 10,

        percent: 10,
        total: 10,
        loaded: 2,
        speed: 2,
        estimatedTime: 10,
        missedRanges: undefined,
    });

    state.setPause(id);
    expect(state.get(id)).toEqual({
        id,
        type: "UPLOAD",
        status: "PAUSE",
        localPath: "local",
        targetId: 1,
        targetPath: "/test1",
        targetUri: "sftp://1/test1",
        name: "name",
        size: 10,

        percent: 10,
        total: 10,
        loaded: 2,
        speed: 2,
        estimatedTime: 10,
        missedRanges: undefined,
    });

    state.setResume(id);
    expect(state.get(id)).toEqual({
        id,
        type: "UPLOAD",
        status: "WAIT",
        localPath: "local",
        targetId: 1,
        targetPath: "/test1",
        targetUri: "sftp://1/test1",
        name: "name",
        size: 10,

        percent: 10,
        total: 10,
        loaded: 2,
        speed: 2,
        estimatedTime: 10,
        missedRanges: undefined,
    });

    state.setSuccess(id);
    expect(state.get(id)).toEqual({
        id,
        type: "UPLOAD",
        status: "SUCCESS",
        localPath: "local",
        targetId: 1,
        targetPath: "/test1",
        targetUri: "sftp://1/test1",
        name: "name",
        size: 10,

        percent: 10,
        total: 10,
        loaded: 2,
        speed: 2,
        estimatedTime: 10,
        missedRanges: undefined,
    });
    state.setFail(id, "test");
    expect(state.get(id)).toEqual({
        id,
        type: "UPLOAD",
        status: "FAIL",
        localPath: "local",
        targetId: 1,
        targetPath: "/test1",
        targetUri: "sftp://1/test1",
        name: "name",
        size: 10,

        percent: 10,
        total: 10,
        loaded: 2,
        speed: 2,
        estimatedTime: 10,
        missedRanges: undefined,

        failReason: "test",
    });
});
