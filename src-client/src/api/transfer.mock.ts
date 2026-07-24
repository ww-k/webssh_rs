import type { ITransferTask, ITransferTaskStatus } from "./transfer";

const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;
const MOCK_TRANSFER_TASK_ID_PREFIX = "mock-transfer-";
const now = Date.now();

let mockTransferTasks: ITransferTask[] = [
    {
        id: `${MOCK_TRANSFER_TASK_ID_PREFIX}wait`,
        type: "UPLOAD",
        status: "WAIT",
        local_path: "/Users/demo/Documents/project-source.tar.gz",
        target_uri: "sftp:1:/home/demo/project-source.tar.gz",
        target_id: 1,
        name: "project-source.tar.gz",
        loaded: 0,
        total: 2.4 * GIBIBYTE,
        percent: 0,
        speed: 0,
        ranges: [],
        created_at: now - 45_000,
        updated_at: now - 45_000,
    },
    {
        id: `${MOCK_TRANSFER_TASK_ID_PREFIX}run`,
        type: "DOWNLOAD",
        status: "RUN",
        local_path: "/Users/demo/Downloads/ubuntu-24.04.iso",
        target_uri: "sftp:1:/data/images/ubuntu-24.04.iso",
        target_id: 1,
        name: "ubuntu-24.04.iso",
        loaded: 1.37 * GIBIBYTE,
        total: 4.7 * GIBIBYTE,
        percent: 29.15,
        speed: 34.8 * MEBIBYTE,
        estimated_time: 748,
        ranges: [[0, 1.37 * GIBIBYTE]],
        created_at: now - 62_000,
        updated_at: now,
    },
    {
        id: `${MOCK_TRANSFER_TASK_ID_PREFIX}pause`,
        type: "UPLOAD",
        status: "PAUSE",
        local_path: "/Users/demo/Projects/design-assets.zip",
        target_uri: "sftp:1:/home/demo/design-assets.zip",
        target_id: 1,
        name: "design-assets.zip",
        loaded: 780 * MEBIBYTE,
        total: 1.8 * GIBIBYTE,
        percent: 42.32,
        speed: 0,
        ranges: [[0, 780 * MEBIBYTE]],
        created_at: now - 180_000,
        updated_at: now - 38_000,
    },
    {
        id: `${MOCK_TRANSFER_TASK_ID_PREFIX}success`,
        type: "DOWNLOAD",
        status: "SUCCESS",
        local_path: "/Users/demo/Downloads/release-v2.4.1.dmg",
        target_uri: "sftp:1:/releases/release-v2.4.1.dmg",
        target_id: 1,
        name: "release-v2.4.1.dmg",
        loaded: 186 * MEBIBYTE,
        total: 186 * MEBIBYTE,
        percent: 100,
        speed: 28.4 * MEBIBYTE,
        ranges: [[0, 186 * MEBIBYTE]],
        created_at: now - 80_000,
        updated_at: now - 12_000,
        ended_at: now - 12_000,
    },
    {
        id: `${MOCK_TRANSFER_TASK_ID_PREFIX}fail`,
        type: "UPLOAD",
        status: "FAIL",
        local_path: "/Users/demo/Backups/database-snapshot.sql.gz",
        target_uri: "sftp:1:/backups/database-snapshot.sql.gz",
        target_id: 1,
        name: "database-snapshot.sql.gz",
        loaded: 320 * MEBIBYTE,
        total: 900 * MEBIBYTE,
        percent: 35.56,
        speed: 0,
        ranges: [[0, 320 * MEBIBYTE]],
        fail_reason: "连接已断开",
        created_at: now - 150_000,
        updated_at: now - 28_000,
        ended_at: now - 28_000,
    },
    {
        id: `${MOCK_TRANSFER_TASK_ID_PREFIX}cancel`,
        type: "DOWNLOAD",
        status: "CANCEL",
        local_path: "/Users/demo/Downloads/training-data.csv",
        target_uri: "sftp:1:/datasets/training-data.csv",
        target_id: 1,
        name: "training-data.csv",
        loaded: 110 * MEBIBYTE,
        total: 1.2 * GIBIBYTE,
        percent: 8.95,
        speed: 0,
        ranges: [[0, 110 * MEBIBYTE]],
        created_at: now - 110_000,
        updated_at: now - 54_000,
        ended_at: now - 54_000,
    },
];

const cloneTask = (task: ITransferTask): ITransferTask => ({
    ...task,
    ranges: task.ranges.map((range) => [...range]),
});

export const isMockTransferTaskId = (id: string) =>
    id.startsWith(MOCK_TRANSFER_TASK_ID_PREFIX);

export const getMockTransferTasks = () => mockTransferTasks.map(cloneTask);

export const getMockTransferTask = (id: string) => {
    const task = mockTransferTasks.find((item) => item.id === id);
    if (!task) throw new Error(`Mock transfer task not found: ${id}`);
    return cloneTask(task);
};

export const setMockTransferTaskStatus = (
    id: string,
    status: ITransferTaskStatus,
) => {
    const index = mockTransferTasks.findIndex((item) => item.id === id);
    if (index === -1) throw new Error(`Mock transfer task not found: ${id}`);

    const task = mockTransferTasks[index];
    const updatedTask: ITransferTask = {
        ...task,
        status,
        speed: status === "RUN" ? 24.6 * MEBIBYTE : 0,
        estimated_time: status === "RUN" ? 120 : undefined,
        updated_at: Date.now(),
        ended_at: ["SUCCESS", "FAIL", "CANCEL"].includes(status)
            ? Date.now()
            : undefined,
    };
    mockTransferTasks = [
        ...mockTransferTasks.slice(0, index),
        updatedTask,
        ...mockTransferTasks.slice(index + 1),
    ];
    return cloneTask(updatedTask);
};

export const deleteMockTransferTask = (id: string) => {
    mockTransferTasks = mockTransferTasks.filter((item) => item.id !== id);
};
