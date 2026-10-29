import {
    ArrowDownOutlined,
    ArrowUpOutlined,
    DeleteOutlined,
    DownOutlined,
    FolderOpenOutlined,
    MoreOutlined,
    PauseCircleOutlined,
    PlayCircleOutlined,
    ReloadOutlined,
    RightOutlined,
    StopOutlined,
} from "@ant-design/icons";
import {
    Button,
    Dropdown,
    Modal,
    message,
    Progress,
    Segmented,
    Select,
    Table,
    Tooltip,
    Typography,
} from "antd";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import "./index.css";

import { postFsShowInFolder } from "@/api";
import transferService from "@/services/transfer";

import type { MenuProps, TableProps } from "antd";
import type { TFunction } from "i18next";
import type {
    ITransferBatch,
    ITransferTask,
    ITransferTaskStatus,
    ITransferTaskType,
} from "@/api";

const { Text } = Typography;
type TransferRow = ITransferTask | ITransferBatch;
type TransferTypeFilter = "ALL" | ITransferTaskType;
type TransferFilterState = {
    type: TransferTypeFilter;
    status?: ITransferTaskStatus;
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
        .filter((task) => isFinishedTransferStatus(task.status)).length +
    transferService
        .getBatches()
        .filter((batch) => isFinishedTransferStatus(batch.status)).length;

const getStoredTransferFilters = (): TransferFilterState => {
    try {
        const value = JSON.parse(
            window.sessionStorage.getItem(transferFilterStorageKey) || "null",
        ) as Record<string, unknown> | null;
        const type = value?.type;
        const status = value?.status;
        return {
            type: type === "UPLOAD" || type === "DOWNLOAD" ? type : "ALL",
            ...(typeof status === "string" &&
            Object.keys(STATUS_TEXT_KEY).includes(status as ITransferTaskStatus)
                ? { status: status as ITransferTaskStatus }
                : {}),
        };
    } catch {
        return { type: "ALL" };
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
                <Progress
                    percent={progressPercent}
                    size={["100%", 4]}
                    status={progressStatus}
                    showInfo={false}
                />
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

export const TransferTable = ({
    type,
    status,
}: {
    type: TransferTypeFilter;
    status?: ITransferTaskStatus;
}) => {
    const { t } = useTranslation();
    const [list, setList] = useState<ITransferTask[]>(() =>
        transferService.getTasks(),
    );
    useEffect(() => transferService.subscribe(setList), []);
    const filteredList = useMemo(
        () =>
            list.filter(
                (item) =>
                    (type === "ALL" || item.type === type) &&
                    (!status || item.status === status),
            ),
        [list, status, type],
    );
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
            ...(getCommonColumns(t) || []),
            {
                title: t("app_common_action"),
                key: "action",
                width: "10%",
                align: "center" as const,
                render: (_: unknown, record: ITransferTask) => (
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
        <Table<ITransferTask>
            columns={columns as TableProps<ITransferTask>["columns"]}
            dataSource={filteredList}
            rowKey="id"
            size="small"
            pagination={{
                pageSize: 10,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total) =>
                    t("transfer_task_total", { count: total }),
            }}
        />
    );
};

interface BatchItemsView {
    items: ITransferTask[];
    total: number;
    page: number;
    pageSize: number;
}

const DEFAULT_BATCH_ITEMS_VIEW: BatchItemsView = {
    items: [],
    total: 0,
    page: 1,
    pageSize: 10,
};

const BatchTable = ({
    type,
    status,
}: {
    type?: ITransferTaskType;
    status?: ITransferTaskStatus;
}) => {
    const { t } = useTranslation();
    const [list, setList] = useState<ITransferBatch[]>(() =>
        transferService.getBatches(),
    );
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [items, setItems] = useState<Record<string, BatchItemsView>>({});
    const [expanded, setExpanded] = useState<string[]>([]);
    const itemsRef = useRef(items);
    itemsRef.current = items;
    const refreshRef = useRef<() => Promise<unknown>>(async () => undefined);
    const refresh = useCallback(async () => {
        const response = await transferService.getBatchesPage({
            page,
            pageSize,
            type,
            status,
        });
        setList(response.items);
        setTotal(response.total);
        return response;
    }, [page, pageSize, status, type]);
    refreshRef.current = refresh;

    const filterKey = `${type || "ALL"}:${status || "ALL"}`;
    // Reset the server-side page when a filter changes.
    // biome-ignore lint/correctness/useExhaustiveDependencies: filterKey intentionally triggers this reset.
    useEffect(() => {
        setPage(1);
    }, [filterKey]);

    useEffect(() => {
        let disposed = false;
        let timer: number | undefined;
        const poll = async () => {
            try {
                const response = await refresh();
                if (
                    !disposed &&
                    response.items.some((batch) =>
                        ["WAIT", "RUN", "PAUSE"].includes(batch.status),
                    )
                ) {
                    timer = window.setTimeout(poll, 1000);
                }
            } catch (err) {
                console.warn("TransferService.getBatchesPage failed", err);
            }
        };
        poll();
        return () => {
            disposed = true;
            if (timer !== undefined) window.clearTimeout(timer);
        };
    }, [refresh]);

    useEffect(
        () => transferService.subscribeBatches(() => refreshRef.current()),
        [],
    );

    const expandedBatchIds = useMemo(
        () => expanded.filter((id) => list.some((item) => item.id === id)),
        [expanded, list],
    );
    const activeExpanded = useMemo(
        () =>
            expandedBatchIds.filter((id) => {
                const batch = list.find((item) => item.id === id);
                return batch && ["WAIT", "RUN", "PAUSE"].includes(batch.status);
            }),
        [expandedBatchIds, list],
    );
    const expandedBatchKey = expandedBatchIds.join(",");
    const activeExpandedKey = activeExpanded.join(",");
    const itemPageKey = expandedBatchIds
        .map((id) => {
            const view = items[id] || DEFAULT_BATCH_ITEMS_VIEW;
            return `${id}:${view.page}:${view.pageSize}`;
        })
        .join(",");

    // The serialized keys restart polling when expanded rows or child pagination changes.
    // biome-ignore lint/correctness/useExhaustiveDependencies: the keys intentionally control the polling lifecycle.
    useEffect(() => {
        if (expandedBatchIds.length === 0) return;
        let disposed = false;
        const refreshItems = async (ids: string[]) => {
            const responses = await Promise.all(
                ids.map((id) => {
                    const view =
                        itemsRef.current[id] || DEFAULT_BATCH_ITEMS_VIEW;
                    return transferService.getBatchItems(
                        id,
                        view.page,
                        view.pageSize,
                    );
                }),
            );
            if (disposed) return;
            setItems((current) => {
                const next = { ...current };
                ids.forEach((id, index) => {
                    const view = current[id] || DEFAULT_BATCH_ITEMS_VIEW;
                    const response = responses[index];
                    next[id] = {
                        ...view,
                        items: response.items,
                        total: response.total,
                        page: Math.min(
                            view.page,
                            Math.max(
                                1,
                                Math.ceil(response.total / view.pageSize),
                            ),
                        ),
                    };
                });
                return next;
            });
        };
        refreshItems(expandedBatchIds).catch((err) =>
            console.warn("TransferService.getBatchItems failed", err),
        );
        if (activeExpanded.length === 0) {
            return () => {
                disposed = true;
            };
        }
        const timer = window.setInterval(
            () =>
                refreshItems(activeExpanded).catch((err) =>
                    console.warn("TransferService.getBatchItems failed", err),
                ),
            1000,
        );
        return () => {
            disposed = true;
            window.clearInterval(timer);
        };
    }, [
        activeExpanded,
        activeExpandedKey,
        expandedBatchIds,
        expandedBatchKey,
        itemPageKey,
    ]);

    const handleExpand = useCallback(
        (isExpanded: boolean, record: ITransferBatch) => {
            if (isExpanded) {
                setItems((current) => ({
                    ...current,
                    [record.id]: current[record.id] || DEFAULT_BATCH_ITEMS_VIEW,
                }));
            }
            setExpanded((current) =>
                isExpanded
                    ? [...current, record.id]
                    : current.filter((id) => id !== record.id),
            );
        },
        [],
    );
    const batchName = useCallback(
        (record: TransferRow) => {
            if (!isBatch(record)) return record.name;
            const isExpanded = expanded.includes(record.id);
            return (
                <span className="WebSSH-TransferBatchNameCell">
                    <Button
                        className="WebSSH-TransferExpandAction"
                        type="text"
                        aria-expanded={isExpanded}
                        aria-label={record.name}
                        icon={isExpanded ? <DownOutlined /> : <RightOutlined />}
                        onClick={() => handleExpand(!isExpanded, record)}
                    />
                    {record.name}
                </span>
            );
        },
        [expanded, handleExpand],
    );
    const columns = useMemo(
        () => [
            ...(getCommonColumns(t, batchName) || []),
            {
                title: t("app_common_action"),
                key: "action",
                width: "10%",
                align: "center" as const,
                render: (_: unknown, record: ITransferBatch) => {
                    const action = async (fn: () => Promise<unknown>) => {
                        await fn();
                        await refreshRef.current();
                    };
                    const menuItems: MenuProps["items"] = [];
                    if (record.status === "RUN" || record.status === "WAIT") {
                        menuItems.push({
                            key: "pause",
                            label: t("transfer_action_pause"),
                            icon: <PauseCircleOutlined />,
                            onClick: () =>
                                action(() =>
                                    transferService.pauseBatch(record.id),
                                ),
                        });
                        menuItems.push({
                            key: "cancel",
                            label: t("app_btn_cancel"),
                            icon: <StopOutlined />,
                            onClick: () =>
                                action(() =>
                                    transferService.cancelBatch(record.id),
                                ),
                        });
                    } else if (record.status === "PAUSE") {
                        menuItems.push({
                            key: "resume",
                            label: t("transfer_action_resume"),
                            icon: <PlayCircleOutlined />,
                            onClick: () =>
                                action(() =>
                                    transferService.resumeBatch(record.id),
                                ),
                        });
                        menuItems.push({
                            key: "cancel",
                            label: t("app_btn_cancel"),
                            icon: <StopOutlined />,
                            onClick: () =>
                                action(() =>
                                    transferService.cancelBatch(record.id),
                                ),
                        });
                    } else if (
                        record.status === "FAIL" ||
                        record.status === "CANCEL"
                    ) {
                        menuItems.push({
                            key: "retry",
                            label: t("transfer_action_retry"),
                            icon: <ReloadOutlined />,
                            onClick: () =>
                                action(() =>
                                    transferService.resumeBatch(record.id),
                                ),
                        });
                    }
                    menuItems.push({ type: "divider" });
                    menuItems.push({
                        key: "delete",
                        label: t("app_btn_delete"),
                        danger: true,
                        icon: <DeleteOutlined />,
                        onClick: () =>
                            action(() =>
                                transferService.removeBatch(record.id),
                            ),
                    });
                    return <ActionButton t={t} items={menuItems} />;
                },
            },
        ],
        [batchName, t],
    );
    const expandedRowRender = useCallback(
        (record: ITransferBatch) => {
            const view = items[record.id] || DEFAULT_BATCH_ITEMS_VIEW;
            const childColumns = [
                ...(getCommonColumns(
                    t,
                    undefined,
                    "WebSSH-TransferFileNameCell",
                ) || []),
                {
                    title: t("app_common_action"),
                    key: "action",
                    width: "10%",
                    align: "center" as const,
                    render: (_: unknown, item: ITransferTask) => (
                        <ActionButton
                            t={t}
                            items={getActionMenuItems(
                                item,
                                t,
                                () => transferService.pause(item.id),
                                () =>
                                    transferService
                                        .resume(item.id)
                                        .catch(console.warn),
                                () => transferService.cancel(item.id),
                                () => transferService.remove(item.id),
                                () =>
                                    item.local_path &&
                                    postFsShowInFolder(item.local_path).catch(
                                        console.warn,
                                    ),
                            )}
                        />
                    ),
                },
            ];
            return (
                <Table<ITransferTask>
                    columns={
                        childColumns as TableProps<ITransferTask>["columns"]
                    }
                    dataSource={view.items}
                    showHeader={false}
                    rowKey="id"
                    size="small"
                    pagination={{
                        current: view.page,
                        pageSize: view.pageSize,
                        total: view.total,
                        showSizeChanger: true,
                        onChange: (nextPage, nextPageSize) =>
                            setItems((current) => ({
                                ...current,
                                [record.id]: {
                                    ...view,
                                    page: nextPage,
                                    pageSize: nextPageSize,
                                },
                            })),
                    }}
                />
            );
        },
        [items, t],
    );
    return (
        <Table<ITransferBatch>
            columns={columns as TableProps<ITransferBatch>["columns"]}
            dataSource={list}
            rowKey="id"
            size="small"
            expandable={{
                showExpandColumn: false,
                expandedRowKeys: expanded,
                onExpand: handleExpand,
                expandedRowRender,
            }}
            pagination={{
                current: page,
                pageSize,
                total,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (count) => t("transfer_batch_total", { count }),
                onChange: (nextPage, nextPageSize) => {
                    setPage(nextPageSize !== pageSize ? 1 : nextPage);
                    setPageSize(nextPageSize);
                },
            }}
        />
    );
};

export default function Transfer() {
    const { t } = useTranslation();
    const [viewMode, setViewMode] = useState<"batch" | "file">("batch");
    const [filters, setFilters] = useState<TransferFilterState>(
        getStoredTransferFilters,
    );
    const { type, status } = filters;
    useEffect(() => {
        storeTransferFilters(filters);
    }, [filters]);
    const [finishedHistoryCount, setFinishedHistoryCount] = useState(
        getFinishedHistoryCount,
    );
    useEffect(() => {
        const update = () => setFinishedHistoryCount(getFinishedHistoryCount());
        const unsubscribeTasks = transferService.subscribe(update);
        const unsubscribeBatches = transferService.subscribeBatches(update);
        return () => {
            unsubscribeTasks();
            unsubscribeBatches();
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
    const typeOptions = [
        { value: "ALL", label: t("transfer_filter_all") },
        { value: "UPLOAD", label: t("transfer_type_upload") },
        { value: "DOWNLOAD", label: t("transfer_type_download") },
    ];
    const statusOptions = [
        { value: "ALL", label: t("transfer_filter_all") },
        ...Object.keys(STATUS_TEXT_KEY).map((value) => ({
            value,
            label: t(STATUS_TEXT_KEY[value as ITransferTaskStatus]),
        })),
    ];
    return (
        <div className="WebSSH-Transfer">
            <div className="WebSSH-TransferToolbar">
                <Segmented
                    value={viewMode}
                    onChange={(value) => setViewMode(value as "batch" | "file")}
                    options={[
                        {
                            value: "batch",
                            label: t("transfer_view_batches"),
                        },
                        {
                            value: "file",
                            label: t("transfer_view_files"),
                        },
                    ]}
                />
                <Select
                    aria-label={t("transfer_filter_type")}
                    value={type}
                    options={typeOptions}
                    onChange={(value) =>
                        setFilters((current) => ({
                            ...current,
                            type: value,
                        }))
                    }
                />
                <Select
                    aria-label={t("transfer_filter_status")}
                    value={status || "ALL"}
                    options={statusOptions}
                    onChange={(value) =>
                        setFilters((current) => ({
                            ...current,
                            ...(value === "ALL"
                                ? { status: undefined }
                                : {
                                      status: value as ITransferTaskStatus,
                                  }),
                        }))
                    }
                />
                <Button
                    className="WebSSH-TransferDeleteHistory"
                    danger
                    disabled={finishedHistoryCount === 0}
                    icon={<DeleteOutlined />}
                    onClick={handleRemoveAll}
                >
                    {t("transfer_action_delete_all_history")}
                </Button>
            </div>
            <div className="WebSSH-TransferContent">
                {viewMode === "batch" ? (
                    <BatchTable
                        type={type === "ALL" ? undefined : type}
                        status={status}
                    />
                ) : (
                    <TransferTable type={type} status={status} />
                )}
            </div>
        </div>
    );
}
