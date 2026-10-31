import {
    ArrowDownOutlined,
    ArrowUpOutlined,
    DeleteOutlined,
    FileOutlined,
    FolderOpenOutlined,
    FolderOutlined,
    MinusOutlined,
    MoreOutlined,
    PauseCircleOutlined,
    PlayCircleOutlined,
    PlusOutlined,
    ReloadOutlined,
    SearchOutlined,
    StopOutlined,
} from "@ant-design/icons";
import {
    Button,
    Dropdown,
    Input,
    Modal,
    message,
    Progress,
    Segmented,
    Table,
    Tooltip,
    Typography,
} from "antd";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import "./index.css";

import { postFsShowInFolder } from "@/api";
import transferService, { getTransferBatchName } from "@/services/transfer";

import type { MenuProps, TableProps } from "antd";
import type { TFunction } from "i18next";
import type { ComponentType } from "react";
import type {
    ITransferBatch,
    ITransferTask,
    ITransferTaskStatus,
    ITransferTaskType,
} from "@/api";

const { Text } = Typography;
type TransferRow = ITransferTask | ITransferBatch;
type TransferTreeRow = TransferRow & {
    children?: TransferTreeRow[];
    isVirtual?: boolean;
};
const TransferVirtualTable = Table as unknown as ComponentType<
    TableProps<TransferTreeRow> & { listItemHeight?: number }
>;
const TRANSFER_ROW_HEIGHT = 56;
type TransferTypeFilter = "ALL" | ITransferTaskType;
type TransferFilterState = {
    type: TransferTypeFilter;
    keyword: string;
};

const transferFilterStorageKey = "webssh:transfer-filters";

const STATUS_TEXT_KEY: Record<ITransferTaskStatus, string> = {
    WAIT: "transfer_status_waiting",
    RUN: "transfer_status_running",
    PAUSE: "transfer_status_paused",
    SUCCESS: "transfer_status_completed",
    FAIL: "transfer_status_failed",
    CANCEL: "transfer_status_cancelled",
};

const isFinishedTransferStatus = (status: ITransferTaskStatus) =>
    ["SUCCESS", "FAIL", "CANCEL"].includes(status);

const getFinishedHistoryCount = () =>
    transferService
        .getTasks()
        .filter((task) => isFinishedTransferStatus(task.status)).length;

const getStoredTransferFilters = (): TransferFilterState => {
    try {
        const value = JSON.parse(
            window.sessionStorage.getItem(transferFilterStorageKey) || "null",
        ) as Record<string, unknown> | null;
        const type = value?.type;
        const keyword = value?.keyword;
        return {
            type: type === "UPLOAD" || type === "DOWNLOAD" ? type : "ALL",
            keyword: typeof keyword === "string" ? keyword : "",
        };
    } catch {
        return { type: "ALL", keyword: "" };
    }
};

const storeTransferFilters = (filters: TransferFilterState) => {
    try {
        window.sessionStorage.setItem(
            transferFilterStorageKey,
            JSON.stringify(filters),
        );
    } catch {
        // Session storage is optional and may be unavailable in restricted webviews.
    }
};

const formatSize = (bytes?: number): string => {
    if (bytes === undefined) return "-";
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
};

const formatSpeed = (speed?: number): string =>
    speed ? `${formatSize(speed)}/s` : "-";

const formatDuration = (seconds?: number): string => {
    const totalSeconds = Math.max(0, Math.ceil(seconds ?? 0));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = totalSeconds % 60;
    return [hours, minutes, remainingSeconds]
        .map((value) => String(value).padStart(2, "0"))
        .join(":");
};

const isBatch = (record: TransferRow): record is ITransferBatch =>
    "item_count" in record;

const TransferTreeExpandIcon = ({
    expanded,
    onExpand,
    record,
}: {
    expanded: boolean;
    onExpand: (
        record: TransferTreeRow,
        event: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    ) => void;
    record: TransferTreeRow;
}) => {
    const hasChildren = Boolean(record.children?.length);
    if (isBatch(record)) {
        return (
            <button
                type="button"
                className="WebSSH-TransferTreeIcon WebSSH-TransferTreeIcon--batch"
                aria-expanded={hasChildren ? expanded : undefined}
                aria-label={record.name}
                onClick={(event) => {
                    if (hasChildren) onExpand(record, event);
                }}
            >
                {expanded && hasChildren ? (
                    <MinusOutlined aria-hidden="true" />
                ) : (
                    <PlusOutlined aria-hidden="true" />
                )}
            </button>
        );
    }
    const directory = record.kind === "DIRECTORY" || hasChildren;
    if (!directory) {
        return (
            <span className="WebSSH-TransferTreeIcon WebSSH-TransferTreeIcon--file">
                <FileOutlined aria-hidden="true" />
            </span>
        );
    }
    return (
        <button
            type="button"
            className="WebSSH-TransferTreeIcon WebSSH-TransferTreeIcon--directory"
            aria-expanded={hasChildren ? expanded : undefined}
            aria-label={record.name}
            onClick={(event) => {
                if (hasChildren) onExpand(record, event);
            }}
        >
            {expanded && hasChildren ? (
                <FolderOpenOutlined aria-hidden="true" />
            ) : (
                <FolderOutlined aria-hidden="true" />
            )}
        </button>
    );
};

const TransferTypeCell = memo(
    ({ type, t }: { type: ITransferTaskType; t: TFunction }) => {
        const isUpload = type === "UPLOAD";
        const label = t(
            isUpload ? "transfer_type_upload" : "transfer_type_download",
        );
        return (
            <Tooltip title={label}>
                <span
                    className={`WebSSH-TransferType WebSSH-TransferType--${type.toLowerCase()}`}
                >
                    {isUpload ? (
                        <ArrowUpOutlined aria-label={label} />
                    ) : (
                        <ArrowDownOutlined aria-label={label} />
                    )}
                </span>
            </Tooltip>
        );
    },
);

const TransferProgressCell = memo(
    ({ record, t }: { record: TransferRow; t: TFunction }) => {
        const batch = isBatch(record);
        const progressPercent =
            record.status === "SUCCESS"
                ? 100
                : Number((record.percent || 0).toFixed(2));
        const progressStatus =
            record.status === "SUCCESS"
                ? "success"
                : record.status === "FAIL"
                  ? "exception"
                  : ["PAUSE", "CANCEL"].includes(record.status)
                    ? "normal"
                    : "active";
        const failureReason =
            record.fail_reason || t("transfer_unknown_reason");
        return (
            <div className="WebSSH-TransferProgress">
                <div className="WebSSH-TransferProgressMeta">
                    <Text
                        className="WebSSH-TransferProgressMetaItem WebSSH-TransferProgressMetaItem--size"
                        type="secondary"
                    >
                        {batch
                            ? `${record.completed_count}/${record.item_count} · ${formatSize(record.loaded)}/${formatSize(record.total)}`
                            : `${formatSize(record.loaded)}/${formatSize(record.total)}`}
                    </Text>
                    {record.status === "RUN" ? (
                        <>
                            <Text
                                className="WebSSH-TransferProgressMetaItem WebSSH-TransferProgressMetaItem--speed"
                                type="secondary"
                            >
                                {formatSpeed(record.speed)}
                            </Text>
                            <Text
                                className="WebSSH-TransferProgressMetaItem WebSSH-TransferProgressMetaItem--remaining"
                                type="secondary"
                            >
                                {t("transfer_remaining", {
                                    duration: formatDuration(
                                        record.estimated_time,
                                    ),
                                })}
                            </Text>
                        </>
                    ) : (
                        <>
                            {record.status === "FAIL" && (
                                <Tooltip title={failureReason}>
                                    <Text
                                        className="WebSSH-TransferProgressMetaItem WebSSH-TransferProgressMetaItem--reason"
                                        type="secondary"
                                    >
                                        {failureReason}
                                    </Text>
                                </Tooltip>
                            )}
                            <Text
                                className={`WebSSH-TransferProgressMetaItem WebSSH-TransferProgressMetaItem--status WebSSH-TransferProgressMetaItem--status-${record.status.toLowerCase()}`}
                            >
                                {t(STATUS_TEXT_KEY[record.status])}
                            </Text>
                        </>
                    )}
                </div>
                {record.status !== "SUCCESS" && (
                    <Progress
                        percent={progressPercent}
                        size={["100%", 4]}
                        status={progressStatus}
                        showInfo={false}
                    />
                )}
            </div>
        );
    },
);

const TransferNameCell = memo(
    ({
        record,
        children,
        className,
    }: {
        record: TransferRow;
        children?: React.ReactNode;
        className?: string;
    }) => (
        <Tooltip
            title={
                isBatch(record)
                    ? record.name
                    : record.local_path || record.target_uri || record.name
            }
        >
            <Text
                className={`WebSSH-TransferFileName${className ? ` ${className}` : ""}`}
            >
                {children || record.name}
            </Text>
        </Tooltip>
    ),
);

const getActionMenuItems = (
    record: ITransferTask,
    t: TFunction,
    onPause: () => void,
    onResume: () => void,
    onCancel: () => void,
    onDelete: () => void,
    onShowInFolder: () => void,
): MenuProps["items"] => {
    const items: MenuProps["items"] = [];
    if (record.status === "RUN" || record.status === "WAIT") {
        items.push({
            key: "pause",
            label: t("transfer_action_pause"),
            icon: <PauseCircleOutlined />,
            onClick: onPause,
        });
        items.push({
            key: "cancel",
            label: t("app_btn_cancel"),
            icon: <StopOutlined />,
            onClick: onCancel,
        });
    } else if (record.status === "PAUSE") {
        items.push({
            key: "resume",
            label: t("transfer_action_resume"),
            icon: <PlayCircleOutlined />,
            onClick: onResume,
        });
        items.push({
            key: "cancel",
            label: t("app_btn_cancel"),
            icon: <StopOutlined />,
            onClick: onCancel,
        });
    } else if (record.status === "FAIL" || record.status === "CANCEL") {
        items.push({
            key: "retry",
            label: t("transfer_action_retry"),
            icon: <ReloadOutlined />,
            onClick: onResume,
        });
    }
    if (record.local_path) {
        items.push({
            key: "show-in-folder",
            label: t("transfer_action_show_in_folder"),
            icon: <FolderOpenOutlined />,
            onClick: onShowInFolder,
        });
    }
    if (items.length > 0 && record.status !== "SUCCESS") {
        items.push({ type: "divider" });
    }
    items.push({
        key: "delete",
        label: t("app_btn_delete"),
        icon: <DeleteOutlined />,
        danger: true,
        onClick: onDelete,
    });
    return items;
};

const ActionButton = ({
    items,
    t,
}: {
    items: MenuProps["items"];
    t: TFunction;
}) => (
    <Dropdown menu={{ items }} trigger={["click"]} placement="bottomRight">
        <Tooltip title={t("transfer_action_more")}>
            <Button
                className="WebSSH-TransferAction"
                type="text"
                aria-label={t("transfer_action_more")}
                icon={<MoreOutlined />}
            />
        </Tooltip>
    </Dropdown>
);

const getCommonColumns = (
    t: TFunction,
    renderName?: (record: TransferRow) => React.ReactNode,
    nameClassName?: string,
): TableProps<TransferRow>["columns"] => [
    {
        title: t("transfer_column_filename"),
        dataIndex: "name",
        key: "name",
        width: "32%",
        ellipsis: true,
        render: (_, record) => (
            <TransferNameCell record={record} className={nameClassName}>
                {renderName?.(record)}
            </TransferNameCell>
        ),
    },
    {
        title: t("transfer_column_type"),
        dataIndex: "type",
        key: "type",
        width: "10%",
        align: "center",
        className: "WebSSH-TransferCenterCell",
        render: (type: ITransferTaskType) => (
            <TransferTypeCell type={type} t={t} />
        ),
    },
    {
        title: t("transfer_column_progress"),
        key: "progress",
        width: "48%",
        render: (_, record) => <TransferProgressCell record={record} t={t} />,
    },
];

const normalizeTransferPath = (value: string) =>
    value
        .replace(/\\/g, "/")
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean);

const getTransferStatus = (tasks: ITransferTask[]): ITransferTaskStatus => {
    if (tasks.length === 0) return "WAIT";
    const statuses = new Set(tasks.map((task) => task.status));
    if (statuses.has("RUN")) return "RUN";
    if (statuses.has("WAIT")) return "WAIT";
    if (statuses.has("PAUSE")) return "PAUSE";
    if (statuses.has("FAIL")) return "FAIL";
    if (statuses.has("CANCEL")) return "CANCEL";
    return "SUCCESS";
};

const createAggregateTask = (
    tasks: ITransferTask[],
    id: string,
    name: string,
    batchId?: string,
): ITransferTask => {
    const first = tasks[0];
    const total = tasks.reduce((sum, task) => sum + (task.total || 0), 0);
    const loaded = tasks.reduce((sum, task) => sum + (task.loaded || 0), 0);
    return {
        ...(first || {
            type: "UPLOAD",
            status: "WAIT",
            ranges: [],
            speed: 0,
            created_at: 0,
            updated_at: 0,
        }),
        id,
        name,
        kind: "DIRECTORY",
        status: getTransferStatus(tasks),
        loaded,
        total,
        percent: total > 0 ? (loaded / total) * 100 : 0,
        speed: tasks.reduce((sum, task) => sum + (task.speed || 0), 0),
        ranges: [],
        batch_id: batchId,
    };
};

const createSyntheticBatch = (
    id: string,
    tasks: ITransferTask[],
): ITransferBatch => {
    const first = tasks[0];
    const total = tasks.reduce((sum, task) => sum + (task.total || 0), 0);
    const loaded = tasks.reduce((sum, task) => sum + (task.loaded || 0), 0);
    const sources = [
        ...new Set(
            tasks.map(
                (task) =>
                    normalizeTransferPath(task.relative_path || task.name)[0],
            ),
        ),
    ].filter((source): source is string => Boolean(source));
    return {
        id,
        type: first?.type || "UPLOAD",
        status: getTransferStatus(tasks),
        name: getTransferBatchName(sources.length > 0 ? sources : [id]),
        target_id: first?.target_id,
        conflict_policy: first?.conflict_policy || "OVERWRITE",
        item_count: tasks.length,
        completed_count: tasks.filter((task) => task.status === "SUCCESS")
            .length,
        failed_count: tasks.filter((task) => task.status === "FAIL").length,
        directory_count: tasks.filter((task) => task.kind === "DIRECTORY")
            .length,
        directory_failed_count: tasks.filter(
            (task) => task.kind === "DIRECTORY" && task.status === "FAIL",
        ).length,
        total,
        loaded,
        percent: total > 0 ? (loaded / total) * 100 : 0,
        speed: tasks.reduce((sum, task) => sum + (task.speed || 0), 0),
        estimated_time: first?.estimated_time,
        fail_reason: tasks.find((task) => task.fail_reason)?.fail_reason,
        created_at: Math.min(...tasks.map((task) => task.created_at)),
        updated_at: Math.max(...tasks.map((task) => task.updated_at)),
        ended_at: tasks.every((task) => task.ended_at)
            ? Math.max(...tasks.map((task) => task.ended_at || 0))
            : undefined,
    };
};

// Status order is a presentation rule for the transfer tree.
const TRANSFER_SERVER_STATUS_ORDER: Record<ITransferTaskStatus, number> = {
    FAIL: 0,
    RUN: 1,
    WAIT: 2,
    PAUSE: 3,
    SUCCESS: 4,
    CANCEL: 4,
};

const compareTransferRows = (left: TransferTreeRow, right: TransferTreeRow) => {
    const statusOrder =
        TRANSFER_SERVER_STATUS_ORDER[left.status] -
        TRANSFER_SERVER_STATUS_ORDER[right.status];
    if (statusOrder !== 0) return statusOrder;

    const createdAtOrder = right.created_at - left.created_at;
    if (createdAtOrder !== 0) return createdAtOrder;

    if (right.id < left.id) return -1;
    if (right.id > left.id) return 1;
    return 0;
};

const sortTransferTree = (rows: TransferTreeRow[]) => {
    rows.sort(compareTransferRows);
    for (const row of rows) {
        if (row.children) sortTransferTree(row.children);
    }
    return rows;
};

const buildTransferFileTree = (tasks: ITransferTask[]): TransferTreeRow[] => {
    const grouped = new Map<string, ITransferTask[]>();
    const standalone: TransferTreeRow[] = [];
    for (const task of tasks) {
        if (task.batch_id) {
            const group = grouped.get(task.batch_id) || [];
            group.push(task);
            grouped.set(task.batch_id, group);
        } else {
            standalone.push({ ...task });
        }
    }

    const result: TransferTreeRow[] = [...standalone];
    for (const [batchId, batchTasks] of grouped) {
        const root: TransferTreeRow = {
            ...createSyntheticBatch(batchId, batchTasks),
            children: [],
        };
        const nodes = new Map<string, TransferTreeRow>();
        for (const task of batchTasks) {
            const path = normalizeTransferPath(task.relative_path || task.name);
            if (path.length === 0) continue;
            let parent: TransferTreeRow = root;
            let currentPath = "";
            path.forEach((part, index) => {
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                const isLeaf = index === path.length - 1;
                let node = nodes.get(currentPath);
                if (!node) {
                    const source = isLeaf
                        ? task
                        : createAggregateTask(
                              [task],
                              `transfer-directory:${batchId}:${currentPath}`,
                              part,
                              batchId,
                          );
                    node = {
                        ...source,
                        name: part,
                        children: [],
                        isVirtual: !isLeaf,
                    };
                    nodes.set(currentPath, node);
                    parent.children?.push(node);
                } else if (isLeaf) {
                    node = Object.assign(node, {
                        ...task,
                        name: part,
                        isVirtual: false,
                    });
                }
                parent = node;
            });
        }
        const updateVirtualNodes = (rows: TransferTreeRow[]) => {
            for (const row of rows) {
                if (row.children?.length) updateVirtualNodes(row.children);
                if (!row.isVirtual || isBatch(row)) continue;
                const descendants: ITransferTask[] = [];
                const collectLeaves = (children: TransferTreeRow[]) => {
                    for (const child of children) {
                        if (child.children?.length) {
                            collectLeaves(child.children);
                        } else if (!isBatch(child)) {
                            descendants.push(child);
                        }
                    }
                };
                collectLeaves(row.children || []);
                Object.assign(
                    row,
                    createAggregateTask(descendants, row.id, row.name, batchId),
                    { children: row.children, isVirtual: true },
                );
            }
        };
        updateVirtualNodes(root.children || []);
        sortTransferTree(root.children || []);
        const rootChildren = root.children || [];
        result.push(rootChildren.length === 1 ? rootChildren[0] : root);
    }
    return sortTransferTree(result);
};

const getBatchActionMenuItems = (
    record: ITransferBatch,
    t: TFunction,
    refresh?: () => void,
): MenuProps["items"] => {
    const action = (fn: () => Promise<unknown>) => {
        fn().then(refresh).catch(console.warn);
    };
    const items: MenuProps["items"] = [];
    if (record.status === "RUN" || record.status === "WAIT") {
        items.push(
            {
                key: "pause",
                label: t("transfer_action_pause"),
                icon: <PauseCircleOutlined />,
                onClick: () =>
                    action(() => transferService.pauseBatch(record.id)),
            },
            {
                key: "cancel",
                label: t("app_btn_cancel"),
                icon: <StopOutlined />,
                onClick: () =>
                    action(() => transferService.cancelBatch(record.id)),
            },
        );
    } else if (record.status === "PAUSE") {
        items.push(
            {
                key: "resume",
                label: t("transfer_action_resume"),
                icon: <PlayCircleOutlined />,
                onClick: () =>
                    action(() => transferService.resumeBatch(record.id)),
            },
            {
                key: "cancel",
                label: t("app_btn_cancel"),
                icon: <StopOutlined />,
                onClick: () =>
                    action(() => transferService.cancelBatch(record.id)),
            },
        );
    } else if (record.status === "FAIL" || record.status === "CANCEL") {
        items.push({
            key: "retry",
            label: t("transfer_action_retry"),
            icon: <ReloadOutlined />,
            onClick: () => action(() => transferService.resumeBatch(record.id)),
        });
    }
    if (items.length > 0) items.push({ type: "divider" });
    items.push({
        key: "delete",
        label: t("app_btn_delete"),
        danger: true,
        icon: <DeleteOutlined />,
        onClick: () => action(() => transferService.removeBatch(record.id)),
    });
    return items;
};

export const TransferTable = ({
    type,
    keyword,
}: {
    type: TransferTypeFilter;
    keyword: string;
}) => {
    const { t } = useTranslation();
    const tableContainerRef = useRef<HTMLDivElement>(null);
    const [tableSize, setTableSize] = useState({ width: 0, height: 0 });
    const [list, setList] = useState<ITransferTask[]>(() =>
        transferService.getTasks(),
    );
    useEffect(() => {
        const element = tableContainerRef.current;
        if (!element) return;
        const updateSize = () =>
            setTableSize({
                width: element.clientWidth,
                height: element.clientHeight,
            });
        updateSize();
        const observer = new ResizeObserver(updateSize);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        const unsubscribeTasks = transferService.subscribe(setList);
        return () => {
            unsubscribeTasks();
        };
    }, []);
    const [tree, setTree] = useState<TransferTreeRow[]>([]);
    const [treeLoading, setTreeLoading] = useState(true);
    useEffect(() => {
        let disposed = false;
        setTreeLoading(true);
        const timer = window.setTimeout(() => {
            const normalizedKeyword = keyword.trim().toLocaleLowerCase();
            const filteredList = list.filter((item) => {
                if (type !== "ALL" && item.type !== type) return false;
                if (!normalizedKeyword) return true;
                return [
                    item.name,
                    item.relative_path,
                    item.local_path,
                    item.target_uri,
                ].some((value) =>
                    value?.toLocaleLowerCase().includes(normalizedKeyword),
                );
            });
            const nextTree = buildTransferFileTree(filteredList);
            if (disposed) return;
            setTree(nextTree);
            setTreeLoading(false);
        }, 0);
        return () => {
            disposed = true;
            window.clearTimeout(timer);
        };
    }, [keyword, list, type]);
    const virtualScroll = useMemo(() => {
        if (tableSize.width === 0 || tableSize.height === 0) return undefined;
        return {
            x: Math.max(tableSize.width, 800),
            y: Math.max(tableSize.height - 30, 160),
        };
    }, [tableSize]);
    const handleShowInFolder = useCallback(
        (record: ITransferTask) => {
            if (!record.local_path) return;
            postFsShowInFolder(record.local_path).catch((err) => {
                console.warn("Show transfer in folder failed", err);
                message.error(t("transfer_show_in_folder_failed"));
            });
        },
        [t],
    );
    const handleCancel = useCallback(
        (record: ITransferTask) =>
            Modal.confirm({
                title: t("transfer_confirm_cancel_title"),
                content: t("transfer_confirm_cancel_content", {
                    name: record.name,
                }),
                okText: t("app_btn_ok"),
                cancelText: t("app_btn_cancel"),
                onOk: () => transferService.cancel(record.id),
            }),
        [t],
    );
    const handleDelete = useCallback(
        (record: ITransferTask) =>
            Modal.confirm({
                title: t("transfer_confirm_delete_title"),
                content: t("transfer_confirm_delete_content", {
                    name: record.name,
                }),
                okText: t("app_btn_ok"),
                cancelText: t("app_btn_cancel"),
                onOk: () => transferService.remove(record.id),
            }),
        [t],
    );
    const columns = useMemo(
        () => [
            ...(getCommonColumns(t, (record) =>
                isBatch(record)
                    ? record.name
                    : `${record.name}${record.kind === "DIRECTORY" ? "/" : ""}`,
            ) || []),
            {
                title: t("app_common_action"),
                key: "action",
                width: "10%",
                align: "center" as const,
                className: "WebSSH-TransferCenterCell",
                render: (_: unknown, record: TransferTreeRow) =>
                    isBatch(record) ? (
                        <ActionButton
                            t={t}
                            items={getBatchActionMenuItems(record, t)}
                        />
                    ) : record.isVirtual ? null : (
                        <ActionButton
                            t={t}
                            items={getActionMenuItems(
                                record,
                                t,
                                () => transferService.pause(record.id),
                                () =>
                                    transferService
                                        .resume(record.id)
                                        .catch(console.warn),
                                () => handleCancel(record),
                                () => handleDelete(record),
                                () => handleShowInFolder(record),
                            )}
                        />
                    ),
            },
        ],
        [handleCancel, handleDelete, handleShowInFolder, t],
    );
    return (
        <div ref={tableContainerRef} className="WebSSH-TransferTableContainer">
            <TransferVirtualTable
                className="WebSSH-FilelistTable"
                columns={columns as TableProps<TransferTreeRow>["columns"]}
                dataSource={tree}
                rowKey="id"
                size="small"
                loading={treeLoading}
                listItemHeight={TRANSFER_ROW_HEIGHT}
                virtual={virtualScroll !== undefined}
                scroll={virtualScroll}
                expandable={{
                    defaultExpandAllRows: true,
                    expandIcon: (props) => (
                        <TransferTreeExpandIcon {...props} />
                    ),
                }}
                pagination={false}
            />
        </div>
    );
};

export default function Transfer() {
    const { t } = useTranslation();
    const [filters, setFilters] = useState<TransferFilterState>(
        getStoredTransferFilters,
    );
    const { keyword, type } = filters;
    useEffect(() => {
        storeTransferFilters(filters);
    }, [filters]);
    const [finishedHistoryCount, setFinishedHistoryCount] = useState(
        getFinishedHistoryCount,
    );
    useEffect(() => {
        const update = () => setFinishedHistoryCount(getFinishedHistoryCount());
        const unsubscribeTasks = transferService.subscribe(update);
        return () => {
            unsubscribeTasks();
        };
    }, []);
    const handleRemoveAll = () =>
        Modal.confirm({
            title: t("transfer_confirm_delete_all_title"),
            content: t("transfer_confirm_delete_all_content"),
            okText: t("app_btn_ok"),
            cancelText: t("app_btn_cancel"),
            okButtonProps: { danger: true },
            onOk: () => transferService.removeAll(),
        });
    const typeOptions: { value: TransferTypeFilter; label: string }[] = [
        { value: "ALL", label: t("transfer_filter_all") },
        { value: "UPLOAD", label: t("transfer_type_upload") },
        { value: "DOWNLOAD", label: t("transfer_type_download") },
    ];
    return (
        <div className="WebSSH-MenuPage WebSSH-Transfer">
            <div className="WebSSH-MenuPageToolbar WebSSH-TransferToolbar">
                <label className="WebSSH-TransferFilter">
                    <Segmented
                        aria-label={t("transfer_filter_type")}
                        value={type}
                        options={typeOptions}
                        onChange={(value) =>
                            setFilters((current) => ({
                                ...current,
                                type: value as TransferTypeFilter,
                            }))
                        }
                    />
                </label>
                <label className="WebSSH-TransferFilter">
                    <Input
                        allowClear
                        aria-label={t("transfer_filter_keyword")}
                        className="WebSSH-TransferKeyword"
                        placeholder={t("transfer_filter_keyword")}
                        prefix={<SearchOutlined />}
                        value={keyword}
                        onChange={(event) =>
                            setFilters((current) => ({
                                ...current,
                                keyword: event.target.value,
                            }))
                        }
                    />
                </label>
                <Tooltip title={t("transfer_action_delete_all_history")}>
                    <Button
                        aria-label={t("transfer_action_delete_all_history")}
                        className="WebSSH-TransferDeleteHistory"
                        danger
                        disabled={finishedHistoryCount === 0}
                        icon={<DeleteOutlined />}
                        onClick={handleRemoveAll}
                    />
                </Tooltip>
            </div>
            <div className="WebSSH-MenuPageContent WebSSH-TransferContent">
                <TransferTable type={type} keyword={keyword} />
            </div>
        </div>
    );
}
