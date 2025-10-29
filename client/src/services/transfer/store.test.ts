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
        local: "local",
        remote: "remote",
        name: "name",
        size: 10,
        loaded: 0,
    });
    expect(state.get(id)).toEqual({
        id,
        type: "UPLOAD",
        status: "WAIT",
        local: "local",
        remote: "remote",
        name: "name",
        size: 10,
        loaded: 0,
    });

    state.setRun(id);
    expect(state.get(id)).toEqual({
        id,
        type: "UPLOAD",
        status: "RUN",
        local: "local",
        remote: "remote",
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
        local: "local",
        remote: "remote",
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
        local: "local",
        remote: "remote",
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
        local: "local",
        remote: "remote",
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
        local: "local",
        remote: "remote",
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
        local: "local",
        remote: "remote",
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
        local: "local",
        remote: "remote",
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
        local: "local",
        remote: "remote",
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
