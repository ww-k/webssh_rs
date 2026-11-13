const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;
export const MOCK_ROW_COUNT = 10000;
const mebibytes = (value) => Math.round(value * MEBIBYTE);
const gibibytes = (value) => Math.round(value * GIBIBYTE);

const createTargets = () => {
    const seed = [
        {
            id: 1,
            name: "Local password",
            directory: "Local",
            host: "127.0.0.1",
            method: 1,
            user: "user1",
            key: "",
            password: "111111",
            system: "",
        },
        {
            id: 2,
            name: "Local private key",
            directory: "Local",
            host: "127.0.0.1",
            method: 2,
            user: "user2",
            key: "mock-private-key",
            password: "222222",
            system: "",
        },
        {
            id: 3,
            name: "Windows server",
            directory: "Servers",
            host: "127.0.0.1",
            port: 2222,
            method: 1,
            user: "user3",
            key: "",
            password: "333333",
            system: "windows",
        },
    ];
    return [
        ...seed,
        ...Array.from(
            { length: MOCK_ROW_COUNT - seed.length },
            (_, offset) => {
                const id = seed.length + offset + 1;
                return {
                    id,
                    name: `Mock target ${id}`,
                    directory: id % 3 === 0 ? "Servers" : "",
                    host: `server-${String(id).padStart(5, "0")}.example.test`,
                    port: id % 4 === 0 ? 2222 : 22,
                    method: id % 2 === 0 ? 2 : 1,
                    user: `user${id}`,
                    key: id % 2 === 0 ? "mock-private-key" : "",
                    password: `password-${id}`,
                    system: id % 3 === 0 ? "windows" : "",
                };
            },
        ),
    ];
};

const createTransferTasks = () => {
    const now = Date.now();
    const seed = [
        {
            id: "mock-transfer-wait",
            type: "UPLOAD",
            status: "WAIT",
            local_path: "/Users/demo/Documents/project-source.tar.gz",
            target_uri: "sftp:1:/home/demo/project-source.tar.gz",
            target_id: 1,
            name: "project-source.tar.gz",
            batch_id: "mock-batch-upload",
            relative_path: "projects/project-source.tar.gz",
            loaded: 0,
            total: gibibytes(2.4),
            percent: 0,
            speed: 0,
            ranges: [],
            created_at: now - 45_000,
            updated_at: now - 45_000,
        },
        {
            id: "mock-transfer-run",
            type: "DOWNLOAD",
            status: "RUN",
            local_path: "/Users/demo/Downloads/ubuntu-24.04.iso",
            target_uri: "sftp:1:/data/images/ubuntu-24.04.iso",
            target_id: 1,
            name: "ubuntu-24.04.iso",
            batch_id: "mock-batch-download",
            relative_path: "images/ubuntu-24.04.iso",
            loaded: gibibytes(1.37),
            total: gibibytes(4.7),
            percent: 29.15,
            speed: mebibytes(34.8),
            estimated_time: 748,
            ranges: [[0, gibibytes(1.37)]],
            created_at: now - 62_000,
            updated_at: now,
        },
        {
            id: "mock-transfer-pause",
            type: "UPLOAD",
            status: "PAUSE",
            local_path: "/Users/demo/Projects/design-assets.zip",
            target_uri: "sftp:1:/home/demo/design-assets.zip",
            target_id: 1,
            name: "design-assets.zip",
            batch_id: "mock-batch-upload",
            relative_path: "design/design-assets.zip",
            loaded: mebibytes(780),
            total: gibibytes(1.8),
            percent: 42.32,
            speed: 0,
            ranges: [[0, mebibytes(780)]],
            created_at: now - 180_000,
            updated_at: now - 38_000,
        },
        {
            id: "mock-transfer-success",
            type: "DOWNLOAD",
            status: "SUCCESS",
            local_path: "/Users/demo/Downloads/release-v2.4.1.dmg",
            target_uri: "sftp:1:/releases/release-v2.4.1.dmg",
            target_id: 1,
            name: "release-v2.4.1.dmg",
            batch_id: "mock-batch-download",
            relative_path: "releases/release-v2.4.1.dmg",
            loaded: mebibytes(186),
            total: mebibytes(186),
            percent: 100,
            speed: mebibytes(28.4),
            ranges: [[0, mebibytes(186)]],
            created_at: now - 80_000,
            updated_at: now - 12_000,
            ended_at: now - 12_000,
        },
        {
            id: "mock-transfer-fail",
            type: "UPLOAD",
            status: "FAIL",
            local_path: "/Users/demo/Backups/database-snapshot.sql.gz",
            target_uri: "sftp:1:/backups/database-snapshot.sql.gz",
            target_id: 1,
            name: "database-snapshot.sql.gz",
            batch_id: "mock-batch-upload",
            relative_path: "backups/database-snapshot.sql.gz",
            loaded: mebibytes(320),
            total: mebibytes(900),
            percent: 35.56,
            speed: 0,
            ranges: [[0, mebibytes(320)]],
            fail_reason: "连接已断开",
            created_at: now - 150_000,
            updated_at: now - 28_000,
            ended_at: now - 28_000,
        },
        {
            id: "mock-transfer-cancel",
            type: "DOWNLOAD",
            status: "CANCEL",
            local_path: "/Users/demo/Downloads/training-data.csv",
            target_uri: "sftp:1:/datasets/training-data.csv",
            target_id: 1,
            name: "training-data.csv",
            batch_id: "mock-batch-download",
            relative_path: "datasets/training-data.csv",
            loaded: mebibytes(110),
            total: gibibytes(1.2),
            percent: 8.95,
            speed: 0,
            ranges: [[0, mebibytes(110)]],
            created_at: now - 110_000,
            updated_at: now - 54_000,
            ended_at: now - 54_000,
        },
    ];
    const representativeStatuses = [
        "FAIL",
        "RUN",
        "WAIT",
        "PAUSE",
        "SUCCESS",
        "CANCEL",
    ];
    const representativeTasks = representativeStatuses.flatMap((status) => {
        const batchId = `mock-representative-batch-${status.toLowerCase()}`;
        const total = gibibytes(1);
        const terminal = ["SUCCESS", "FAIL", "CANCEL"].includes(status);
        const createTask = (id, kind, taskBatchId) => ({
            id,
            type:
                status === "RUN" || status === "SUCCESS"
                    ? "DOWNLOAD"
                    : "UPLOAD",
            kind,
            status,
            local_path: `/Users/demo/Downloads/${id}`,
            target_uri: `sftp:1:/mock/${id}`,
            target_id: 1,
            name: id,
            loaded: kind === "FILE" && status === "SUCCESS" ? total : 0,
            total: kind === "FILE" ? total : 0,
            percent: kind === "FILE" && status === "SUCCESS" ? 100 : 0,
            speed: status === "RUN" ? mebibytes(16) : 0,
            estimated_time: status === "RUN" ? 120 : undefined,
            ranges: [],
            fail_reason: status === "FAIL" ? "Mock transfer failed" : undefined,
            created_at: now - 500_000 + representativeStatuses.indexOf(status),
            updated_at: now,
            ended_at: terminal ? now : undefined,
            batch_id: taskBatchId,
            parent_id: null,
            relative_path: id,
        });
        return [
            createTask(
                `mock-${status.toLowerCase()}-batch-directory`,
                "DIRECTORY",
                batchId,
            ),
            createTask(
                `mock-${status.toLowerCase()}-batch-file`,
                "FILE",
                batchId,
            ),
            createTask(
                `mock-${status.toLowerCase()}-directory`,
                "DIRECTORY",
                undefined,
            ),
            createTask(
                `mock-${status.toLowerCase()}-file`,
                "FILE",
                undefined,
            ),
        ];
    });
    return [
        ...representativeTasks,
        ...seed,
        ...Array.from(
            { length: MOCK_ROW_COUNT - seed.length - representativeTasks.length },
            (_, offset) => {
                const index = offset + seed.length + 1;
                const status = "SUCCESS";
                const total = gibibytes(1 + (index % 40) / 10);
                const loaded = status === "SUCCESS"
                    ? total
                    : status === "WAIT"
                      ? 0
                      : Math.round(total * ((index % 80) / 100));
                const targetId = (index % MOCK_ROW_COUNT) + 1;
                const type = index % 2 === 0 ? "DOWNLOAD" : "UPLOAD";
                const createdAt = now - index * 1_000;
                return {
                    id: `mock-transfer-row-${index}`,
                    type,
                    kind: "FILE",
                    status,
                    local_path: `/Users/demo/Downloads/mock-file-${index}.bin`,
                    target_uri: `sftp:${targetId}:/data/mock-file-${index}.bin`,
                    target_id: targetId,
                    name: `mock-file-${index}.bin`,
                    loaded,
                    total,
                    percent: total === 0 ? 0 : Number(((loaded / total) * 100).toFixed(2)),
                    speed: status === "RUN" ? mebibytes(10 + (index % 50)) : 0,
                    estimated_time: status === "RUN" ? 60 + (index % 600) : undefined,
                    ranges: loaded > 0 ? [[0, loaded]] : [],
                    fail_reason: status === "FAIL" ? "Mock transfer failed" : undefined,
                    created_at: createdAt,
                    updated_at: status === "WAIT" ? createdAt : now,
                    ended_at: ["SUCCESS", "FAIL", "CANCEL"].includes(status)
                        ? now
                        : undefined,
                };
            },
        ),
    ];
};

const createKnownHosts = () =>
    Array.from({ length: MOCK_ROW_COUNT }, (_, index) => {
        const id = index + 1;
        const fingerprint = `SHA256:mock-${id.toString(16).padStart(8, "0")}`;
        return {
            id,
            host: `server-${String(id).padStart(5, "0")}.example.test`,
            port: id % 4 === 0 ? 2222 : 22,
            key_algorithm: id % 2 === 0 ? "ssh-ed25519" : "ssh-rsa",
            public_key: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA mock-key-${id}`,
            fingerprint,
        };
    });

const createSshConnections = () =>
    Array.from({ length: MOCK_ROW_COUNT }, (_, index) => {
        const id = index + 1;
        return {
            id: `mock-connection-${id}`,
            expired: id % 13 === 0,
            closed: id % 17 === 0,
            target_id: id,
            active_channels: id % 8,
        };
    });

const file = (name, size, time = 1_638_400_000) => ({
    name,
    type: "f",
    size,
    atime: time,
    mtime: time,
    permissions: "rw-r--r--",
});

const directory = (name, time = 1_638_400_000) => ({
    name,
    type: "d",
    size: 0,
    atime: time,
    mtime: time,
    permissions: "rwxr-xr-x",
});

const createSftpEntries = () =>
    new Map([
        ["/", [directory("Users"), directory("data"), directory("home")]],
        ["/Users", [directory("test")]],
        [
            "/Users/test",
            [
                directory("Desktop"),
                directory("Documents"),
                directory("Downloads"),
            ],
        ],
        ["/Users/test/Desktop", [file("notes.txt", 2_048)]],
        ["/Users/test/Documents", [file("README.md", 4_096)]],
        [
            "/Users/test/Downloads",
            [
                file("file1.txt", 1_024),
                file("file2.txt", 2_048),
                directory("dir1"),
                directory("dir2"),
            ],
        ],
        ["/Users/test/Downloads/dir1", []],
        ["/Users/test/Downloads/dir2", []],
    ]);

const createFsEntries = () =>
    new Map([
        ["/", [directory("Users"), directory("tmp")]],
        ["/Users", [directory("demo")]],
        [
            "/Users/demo",
            [
                directory("Desktop"),
                directory("Downloads"),
                file("notes.txt", 512),
            ],
        ],
        ["/Users/demo/Desktop", []],
        ["/Users/demo/Downloads", [file("example.txt", 1_024)]],
        ["/tmp", []],
    ]);

export const createMockState = () => ({
    targets: createTargets(),
    transferTasks: createTransferTasks(),
    transferBatches: new Map(),
    knownHosts: createKnownHosts(),
    sshConnections: createSshConnections(),
    favoriteDirectories: new Map(),
    preferences: null,
    sftpEntries: createSftpEntries(),
    fsEntries: createFsEntries(),
});
