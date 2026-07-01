import { expect, rs, test } from "@rstest/core";

import transferService from "./index";

import type { ITransferTask } from "@/api";

const tasks: Record<string, ITransferTask> = {};

rs.mock("@/api", () => ({
    postTransferUpload: async (payload: {
        local_path: string;
        target_uri: string;
    }) => {
        const task = createTask({
            id: "upload-1",
            type: "UPLOAD",
            local_path: payload.local_path,
            target_uri: payload.target_uri,
        });
        tasks[task.id] = task;
        return task;
    },
    postTransferDownload: async (payload: {
        source_uri: string;
        local_path?: string;
        local_dir?: string;
    }) => {
        const task = createTask({
            id: "download-1",
            type: "DOWNLOAD",
            local_path: payload.local_path || payload.local_dir,
            target_uri: payload.source_uri,
        });
        tasks[task.id] = task;
        return task;
    },
    getTransferTask: async (id: string) => tasks[id],
    getTransferTasks: async () => Object.values(tasks),
    postTransferPause: async (id: string) => {
        tasks[id].status = "PAUSE";
        return tasks[id];
    },
    postTransferResume: async (id: string) => {
        tasks[id].status = "RUN";
        return tasks[id];
    },
    postTransferCancel: async (id: string) => {
        tasks[id].status = "CANCEL";
        return tasks[id];
    },
    deleteTransferTask: async (id: string) => {
        delete tasks[id];
    },
}));

test("[TransferService] upload creates server task", async () => {
    await transferService.upload({
        localPath: "/tmp/a.txt",
        fileUri: "sftp:1:/tmp/a.txt",
    });

    expect(
        transferService.getTasks().find((task) => task.id === "upload-1"),
    ).toMatchObject({
        id: "upload-1",
        type: "UPLOAD",
        status: "SUCCESS",
        local_path: "/tmp/a.txt",
        target_uri: "sftp:1:/tmp/a.txt",
        target_id: 1,
    });
});

test("[TransferService] download creates server task", async () => {
    await transferService.download({
        fileUri: "sftp:1:/tmp/b.txt",
        localDir: "/tmp",
    });

    expect(
        transferService.getTasks().find((task) => task.id === "download-1"),
    ).toMatchObject({
        id: "download-1",
        type: "DOWNLOAD",
        status: "SUCCESS",
        local_path: "/tmp",
        target_uri: "sftp:1:/tmp/b.txt",
        target_id: 1,
    });
});

function createTask(
    patch: Partial<ITransferTask> & Pick<ITransferTask, "id" | "type">,
): ITransferTask {
    return {
        status: "SUCCESS",
        local_path: undefined,
        target_uri: undefined,
        target_id: 1,
        name: "a.txt",
        loaded: 0,
        total: 10,
        percent: 0,
        speed: 0,
        estimated_time: undefined,
        ranges: [[0, 9]],
        fail_reason: undefined,
        created_at: Date.now(),
        updated_at: Date.now(),
        ended_at: undefined,
        ...patch,
    };
}
