const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;
const mebibytes = (value) => Math.round(value * MEBIBYTE);
const gibibytes = (value) => Math.round(value * GIBIBYTE);

const createTargets = () => [
    {
        id: 1,
        host: "127.0.0.1",
        method: 1,
        user: "user1",
        key: "",
        password: "111111",
        system: "",
    },
    {
        id: 2,
        host: "127.0.0.1",
        method: 2,
        user: "user2",
        key: "mock-private-key",
        password: "222222",
        system: "",
    },
    {
        id: 3,
        host: "127.0.0.1",
        port: 2222,
        method: 1,
        user: "user3",
        key: "",
        password: "333333",
        system: "windows",
    },
];

const createTransferTasks = () => {
    const now = Date.now();
    return [
        {
            id: "mock-transfer-wait",
            type: "UPLOAD",
            status: "WAIT",
            local_path: "/Users/demo/Documents/project-source.tar.gz",
            target_uri: "sftp:1:/home/demo/project-source.tar.gz",
            target_id: 1,
            name: "project-source.tar.gz",
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
};

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
    sftpEntries: createSftpEntries(),
    fsEntries: createFsEntries(),
});
