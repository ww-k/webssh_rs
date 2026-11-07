import {
    ArrowDownOutlined,
    ArrowUpOutlined,
    DeleteOutlined,
    FileOutlined,
    FolderOpenOutlined,
    FolderOutlined,
    MinusOutlined,
    PauseCircleOutlined,
    PlayCircleOutlined,
    PlusOutlined,
    ReloadOutlined,
    SearchOutlined,
    StopOutlined,
} from "@ant-design/icons";
import {
    Button,
    Input,
    Modal,
    message,
    Progress,
    Segmented,
    Space,
    Tooltip,
    Typography,
} from "antd";
import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import "./index.css";

import { postFsShowInFolder } from "@/api";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import useTablePageNavigation from "@/hooks/useTablePageNavigation";
import transferService, { getTransferBatchName } from "@/services/transfer";

import type { TFunction } from "i18next";
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
const TRANSFER_ROW_HEIGHT = 40;
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

const TransferTreeExpandIcon = (
    record: TransferTreeRow,
    expanded: boolean,
    onToggle: () => void,
) => {
    const hasChildren = Boolean(record.children?.length);
    if (isBatch(record)) {
        return (
            <button
                type="button"
                className="WebSSH-TransferTreeIcon WebSSH-TransferTreeIcon--batch"
                aria-expanded={hasChildren ? expanded : undefined}
                aria-label={record.name}
                onClick={(event) => {
                    if (hasChildren) {
                        event.stopPropagation();
                        onToggle();
                    }
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
                if (hasChildren) {
                    event.stopPropagation();
                    onToggle();
                }
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

type TransferAction = {
    key: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
};

const getActionItems = (
    record: ITransferTask,
    t: TFunction,
): TransferAction[] => {
    const canPause = record.status === "RUN" || record.status === "WAIT";
    const canResume = record.status === "PAUSE";
    const canCancel = canPause || canResume;
    const canRetry = record.status === "FAIL" || record.status === "CANCEL";
    const handleShowInFolder = () => {
        if (!record.local_path) return;
        postFsShowInFolder(record.local_path).catch((err) => {
            console.warn("Show transfer in folder failed", err);
            message.error(t("transfer_show_in_folder_failed"));
        });
    };
    const handleCancel = () =>
        Modal.confirm({
            title: t("transfer_confirm_cancel_title"),
            content: t("transfer_confirm_cancel_content", {
                name: record.name,
            }),
            okText: t("app_btn_ok"),
            cancelText: t("app_btn_cancel"),
            onOk: () => transferService.cancel(record.id),
        });
    const handleDelete = () =>
        Modal.confirm({
            title: t("transfer_confirm_delete_title"),
            content: t("transfer_confirm_delete_content", {
                name: record.name,
            }),
            okText: t("app_btn_ok"),
            cancelText: t("app_btn_cancel"),
            onOk: () => transferService.remove(record.id),
        });

    return [
        {
            key: "pause-resume",
            label: canResume
                ? t("transfer_action_resume")
                : t("transfer_action_pause"),
            icon: canResume ? <PlayCircleOutlined /> : <PauseCircleOutlined />,
            onClick: canResume
                ? () => transferService.resume(record.id).catch(console.warn)
                : () => transferService.pause(record.id),
            disabled: !canPause && !canResume,
        },
        {
            key: "cancel",
            label: t("app_btn_cancel"),
            icon: <StopOutlined />,
            onClick: handleCancel,
            disabled: !canCancel,
        },
        {
            key: "retry",
            label: t("transfer_action_retry"),
            icon: <ReloadOutlined />,
            onClick: () => transferService.resume(record.id).catch(console.warn),
            disabled: !canRetry,
        },
        {
            key: "show-in-folder",
            label: t("transfer_action_show_in_folder"),
            icon: <FolderOpenOutlined />,
            onClick: handleShowInFolder,
            disabled: !record.local_path,
        },
        {
            key: "delete",
            label: t("app_btn_delete"),
            icon: <DeleteOutlined />,
            danger: true,
            onClick: handleDelete,
        },
    ];
};

const ActionButtons = ({
    actions,
}: {
    actions: TransferAction[];
}) => (
    <Space className="WebSSH-TransferActions" size="small">
        {actions.map((action) => (
            <Tooltip key={action.key} title={action.label}>
                <Button
                    aria-label={action.label}
                    className="WebSSH-TransferAction"
                    danger={action.danger}
                    disabled={action.disabled}
                    icon={action.icon}
                    type="text"
                    onClick={action.onClick}
                />
            </Tooltip>
        ))}
    </Space>
);

const getUnavailableActionItems = (t: TFunction): TransferAction[] => [
    {
        key: "pause-resume",
        label: t("transfer_action_pause"),
        icon: <PauseCircleOutlined />,
        onClick: () => undefined,
        disabled: true,
    },
    {
        key: "cancel",
        label: t("app_btn_cancel"),
        icon: <StopOutlined />,
        onClick: () => undefined,
        disabled: true,
    },
    {
        key: "retry",
        label: t("transfer_action_retry"),
        icon: <ReloadOutlined />,
        onClick: () => undefined,
        disabled: true,
    },
    {
        key: "show-in-folder",
        label: t("transfer_action_show_in_folder"),
        icon: <FolderOpenOutlined />,
        onClick: () => undefined,
        disabled: true,
    },
    {
        key: "delete",
        label: t("app_btn_delete"),
        icon: <DeleteOutlined />,
        onClick: () => undefined,
        danger: true,
        disabled: true,
    },
];

const getTableColumns = (
    t: TFunction,
): DataTableColumn<TransferTreeRow>[] => {
    const renderAction = (record: TransferTreeRow) =>
        isBatch(record) ? (
            <ActionButtons actions={getBatchActionItems(record, t)} />
        ) : record.isVirtual ? (
            <ActionButtons actions={getUnavailableActionItems(t)} />
        ) : (
            <ActionButtons actions={getActionItems(record, t)} />
        );

    return [
        {
            id: "name",
            header: t("transfer_column_filename"),
            accessor: (record) => record.name,
            width: 320,
            sortable: false,
        },
        {
            id: "type",
            header: t("transfer_column_type"),
            accessor: (record) => record.type,
            width: 100,
            sortable: false,
            align: "center",
            className: "WebSSH-TransferCenterCell",
            cell: (type) => (
                <TransferTypeCell type={type as ITransferTaskType} t={t} />
            ),
        },
        {
            id: "progress",
            header: t("transfer_column_progress"),
            accessor: (record) => record.percent,
            width: 300,
            sortable: false,
            cell: (_value, record) => (
                <TransferProgressCell record={record} t={t} />
            ),
        },
        {
            id: "action",
            header: t("app_common_action"),
            accessor: () => "",
            width: 220,
            sortable: false,
            cell: (_value, record) => renderAction(record),
        },
    ];
};

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

const getBatchActionItems = (
    record: ITransferBatch,
    t: TFunction,
    refresh?: () => void,
): TransferAction[] => {
    const action = (fn: () => Promise<unknown>) => {
        fn().then(refresh).catch(console.warn);
    };
    const canPause = record.status === "RUN" || record.status === "WAIT";
    const canResume = record.status === "PAUSE";
    const canCancel = canPause || canResume;
    const canRetry = record.status === "FAIL" || record.status === "CANCEL";
    return [
        {
            key: "pause-resume",
            label: canResume
                ? t("transfer_action_resume")
                : t("transfer_action_pause"),
            icon: canResume ? <PlayCircleOutlined /> : <PauseCircleOutlined />,
            onClick: canResume
                ? () => action(() => transferService.resumeBatch(record.id))
                : () => action(() => transferService.pauseBatch(record.id)),
            disabled: !canPause && !canResume,
        },
        {
            key: "cancel",
            label: t("app_btn_cancel"),
            icon: <StopOutlined />,
            onClick: () => action(() => transferService.cancelBatch(record.id)),
            disabled: !canCancel,
        },
        {
            key: "retry",
            label: t("transfer_action_retry"),
            icon: <ReloadOutlined />,
            onClick: () => action(() => transferService.resumeBatch(record.id)),
            disabled: !canRetry,
        },
        {
            key: "show-in-folder",
            label: t("transfer_action_show_in_folder"),
            icon: <FolderOpenOutlined />,
            onClick: () => undefined,
            disabled: true,
        },
        {
            key: "delete",
            label: t("app_btn_delete"),
            danger: true,
            icon: <DeleteOutlined />,
            onClick: () => action(() => transferService.removeBatch(record.id)),
        },
    ];
};

export const TransferTable = ({
    type,
    keyword,
    tableBodyHeight,
}: {
    type: TransferTypeFilter;
    keyword: string;
    tableBodyHeight: number;
}) => {
    const { t } = useTranslation();
    const [list, setList] = useState<ITransferTask[]>(() =>
        transferService.getTasks(),
    );

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

    const columns: DataTableColumn<TransferTreeRow>[] = useMemo(
        () =>
            getTableColumns(t),
        [t],
    );
    return (
        <DataTable
            columns={columns}
            data={tree}
            getRowId={(row) => row.id}
            getSubRows={(row) => row.children}
            expandIcon={TransferTreeExpandIcon}
            rowHeight={TRANSFER_ROW_HEIGHT}
            multiple={false}
            selectable={false}
            loading={treeLoading}
            virtual={tableBodyHeight > 0}
        />
    );
};

export default function Transfer() {
    const { t } = useTranslation();
    const {
        tableContainerRef,
        tablePageNavigationProps,
    } = useTablePageNavigation();
    const [tableBodyHeight, setTableBodyHeight] = useState(0);

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
    useEffect(() => {
        const element = tableContainerRef.current;
        if (!element) return;

        const updateTableHeight = () => {
            setTableBodyHeight(Math.max(element.clientHeight - 38, 160));
        };
        updateTableHeight();

        const observer = new ResizeObserver(updateTableHeight);
        observer.observe(element);
        return () => observer.disconnect();
    }, [tableContainerRef]);
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
            <div
                ref={tableContainerRef}
                className="WebSSH-MenuPageContent WebSSH-TransferContent"
                {...tablePageNavigationProps}
            >
                <TransferTable
                    type={type}
                    keyword={keyword}
                    tableBodyHeight={tableBodyHeight}
                />
            </div>
        </div>
    );
}
