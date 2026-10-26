import {
    ArrowDownOutlined,
    ArrowUpOutlined,
    DeleteOutlined,
    FolderOpenOutlined,
    MoreOutlined,
    PauseCircleOutlined,
    PlayCircleOutlined,
    ReloadOutlined,
    StopOutlined,
} from "@ant-design/icons";
import {
    Button,
    ConfigProvider,
    Dropdown,
    Modal,
    message,
    Progress,
    Table,
    Tabs,
    Tooltip,
    Typography,
} from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import "./index.css";

import { postFsShowInFolder } from "@/api";
import transferService from "@/services/transfer";

import type { MenuProps, TableProps } from "antd";
import type { TFunction } from "i18next";
import type { ITransferBatch, ITransferTask } from "@/api";

const { Text } = Typography;

const STATUS_TEXT_KEY: Record<ITransferTask["status"], string> = {
    WAIT: "transfer_status_waiting",
    RUN: "transfer_status_running",
    PAUSE: "transfer_status_paused",
    SUCCESS: "transfer_status_completed",
    FAIL: "transfer_status_failed",
    CANCEL: "transfer_status_cancelled",
};

const isFinishedTransferStatus = (status: ITransferTask["status"]) =>
    ["SUCCESS", "FAIL", "CANCEL"].includes(status);

const getFinishedHistoryCount = () =>
    transferService
        .getTasks()
        .filter((task) => isFinishedTransferStatus(task.status)).length +
    transferService
        .getBatches()
        .filter((batch) => isFinishedTransferStatus(batch.status)).length;

// 格式化文件大小
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

// 格式化传输速度
const formatSpeed = (speed?: number): string => {
    if (!speed) return "-";
    return `${formatSize(speed)}/s`;
};

// 格式化时长
const formatDuration = (seconds?: number): string => {
    const totalSeconds = Math.max(0, Math.ceil(seconds ?? 0));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = totalSeconds % 60;

    return [hours, minutes, remainingSeconds]
        .map((value) => String(value).padStart(2, "0"))
        .join(":");
};

// 获取操作菜单项
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

    switch (record.status) {
        case "RUN":
        case "WAIT":
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
            break;
        case "PAUSE":
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
            break;
        case "FAIL":
            items.push({
                key: "retry",
                label: t("transfer_action_retry"),
                icon: <ReloadOutlined />,
                onClick: onResume,
            });
            break;
        case "CANCEL":
            items.push({
                key: "retry",
                label: t("transfer_action_retry"),
                icon: <ReloadOutlined />,
                onClick: onResume,
            });
            break;
        case "SUCCESS":
            break;
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
        items.push({
            type: "divider",
        });
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

const TransferTable = ({ type }: { type: "ALL" | ITransferTask["type"] }) => {
    const { t } = useTranslation();
    const [list, setList] = useState<ITransferTask[]>(() =>
        transferService.getTasks(),
    );

    useEffect(() => {
        return transferService.subscribe(setList);
    }, []);

    const filteredList =
        type === "ALL" ? list : list.filter((item) => item.type === type);

    const handlePause = (record: ITransferTask) => {
        transferService.pause(record.id);
    };

    const handleResume = (record: ITransferTask) => {
        transferService.resume(record.id).catch((err) => {
            console.warn("Transfer resume failed", err);
        });
    };

    const handleCancel = (record: ITransferTask) => {
        Modal.confirm({
            title: t("transfer_confirm_cancel_title"),
            content: t("transfer_confirm_cancel_content", {
                name: record.name,
            }),
            okText: t("app_btn_ok"),
            cancelText: t("app_btn_cancel"),
            onOk: () => {
                transferService.remove(record.id);
            },
        });
    };

    const handleDelete = (record: ITransferTask) => {
        Modal.confirm({
            title: t("transfer_confirm_delete_title"),
            content: t("transfer_confirm_delete_content", {
                name: record.name,
            }),
            okText: t("app_btn_ok"),
            cancelText: t("app_btn_cancel"),
            onOk: () => {
                transferService.remove(record.id);
            },
        });
    };

    const handleShowInFolder = (record: ITransferTask) => {
        if (!record.local_path) return;

        postFsShowInFolder(record.local_path).catch((err) => {
            console.warn("Show transfer in folder failed", err);
            message.error(t("transfer_show_in_folder_failed"));
        });
    };

    const columns: TableProps<ITransferTask>["columns"] = [
        {
            title: t("transfer_column_filename"),
            dataIndex: "name",
            key: "name",
            width: "24%",
            ellipsis: true,
            render: (text, record) => (
                <Tooltip title={record.local_path || record.target_uri || text}>
                    <Text className="WebSSH-TransferFileName">{text}</Text>
                </Tooltip>
            ),
        },
        {
            title: t("transfer_column_type"),
            dataIndex: "type",
            key: "type",
            width: "10%",
            align: "center",
            render: (transferType: ITransferTask["type"]) => {
                const isUpload = transferType === "UPLOAD";
                const label = t(
                    isUpload
                        ? "transfer_type_upload"
                        : "transfer_type_download",
                );

                return (
                    <Tooltip title={label}>
                        <span
                            className={`WebSSH-TransferType WebSSH-TransferType--${transferType.toLowerCase()}`}
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
        },
        {
            title: t("transfer_column_progress"),
            key: "progress",
            width: "56%",
            render: (_, record) => {
                const { percent, loaded, total } = record;
                const isRunning = record.status === "RUN";
                const failureReason =
                    record.fail_reason || t("transfer_unknown_reason");
                const progressPercent =
                    record.status === "SUCCESS"
                        ? 100
                        : Number((percent || 0).toFixed(2));
                const progressStatus =
                    record.status === "SUCCESS"
                        ? "success"
                        : record.status === "FAIL"
                          ? "exception"
                          : ["PAUSE", "CANCEL"].includes(record.status)
                            ? "normal"
                            : "active";

                return (
                    <div className="WebSSH-TransferProgress">
                        <div className="WebSSH-TransferProgressMeta">
                            <Text
                                className="WebSSH-TransferProgressMetaItem WebSSH-TransferProgressMetaItem--size"
                                type="secondary"
                            >
                                {formatSize(loaded)}/{formatSize(total)}
                            </Text>
                            {isRunning ? (
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
        },
        {
            title: t("app_common_action"),
            key: "action",
            width: "10%",
            align: "center",
            render: (_, record) => {
                const menuItems = getActionMenuItems(
                    record,
                    t,
                    () => handlePause(record),
                    () => handleResume(record),
                    () => handleCancel(record),
                    () => handleDelete(record),
                    () => handleShowInFolder(record),
                );

                return (
                    <Dropdown
                        menu={{ items: menuItems }}
                        trigger={["click"]}
                        placement="bottomRight"
                    >
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
            },
        },
    ];

    return (
        <Table<ITransferTask>
            columns={columns}
            dataSource={filteredList}
            rowKey="id"
            size="small"
            rowClassName="WebSSH-TransferRow"
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

const BatchTable = () => {
    const { t } = useTranslation();
    const [list, setList] = useState<ITransferBatch[]>(() =>
        transferService.getBatches(),
    );
    const [items, setItems] = useState<Record<string, ITransferTask[]>>({});
    const [expanded, setExpanded] = useState<string[]>([]);

    useEffect(() => {
        const unsubscribe = transferService.subscribeBatches(setList);
        return () => {
            unsubscribe();
        };
    }, []);

    const columns: TableProps<ITransferBatch>["columns"] = [
        {
            title: t("transfer_column_filename"),
            dataIndex: "name",
            key: "name",
            ellipsis: true,
        },
        {
            title: t("transfer_column_type"),
            dataIndex: "type",
            key: "type",
            width: "12%",
            render: (type: ITransferBatch["type"]) =>
                type === "UPLOAD"
                    ? t("transfer_type_upload")
                    : t("transfer_type_download"),
        },
        {
            title: t("transfer_column_progress"),
            key: "progress",
            width: "36%",
            render: (_, record) => {
                const percent = record.percent;
                return (
                    <div className="WebSSH-TransferProgress">
                        <div className="WebSSH-TransferProgressMeta">
                            <Text type="secondary">
                                {record.completed_count}/{record.item_count} ·{" "}
                                {formatSize(record.loaded)}/
                                {formatSize(record.total)}
                            </Text>
                            <Text
                                type="secondary"
                                className="WebSSH-TransferProgressMetaItem--speed"
                            >
                                {formatSpeed(record.speed)}
                            </Text>
                        </div>
                        <Progress
                            percent={percent}
                            size={["100%", 4]}
                            showInfo={false}
                        />
                    </div>
                );
            },
        },
        {
            title: t("transfer_status_running"),
            dataIndex: "status",
            key: "status",
            width: "12%",
            render: (status: ITransferBatch["status"]) => (
                <Text
                    className={`WebSSH-TransferProgressMetaItem--status WebSSH-TransferProgressMetaItem--status-${status.toLowerCase()}`}
                >
                    {t(STATUS_TEXT_KEY[status])}
                </Text>
            ),
        },
        {
            title: t("app_common_action"),
            key: "action",
            width: "10%",
            align: "center",
            render: (_, record) => {
                const menuItems: MenuProps["items"] = [];
                if (record.status === "RUN" || record.status === "WAIT") {
                    menuItems.push({
                        key: "pause",
                        label: t("transfer_action_pause"),
                        icon: <PauseCircleOutlined />,
                        onClick: () => transferService.pauseBatch(record.id),
                    });
                    menuItems.push({
                        key: "cancel",
                        label: t("app_btn_cancel"),
                        icon: <StopOutlined />,
                        onClick: () => transferService.cancelBatch(record.id),
                    });
                } else if (
                    record.status === "PAUSE" ||
                    record.status === "FAIL" ||
                    record.status === "CANCEL"
                ) {
                    if (record.status !== "CANCEL") {
                        menuItems.push({
                            key: "resume",
                            label: t("transfer_action_resume"),
                            icon: <PlayCircleOutlined />,
                            onClick: () =>
                                transferService.resumeBatch(record.id),
                        });
                    }
                    if (record.status === "PAUSE") {
                        menuItems.push({
                            key: "cancel",
                            label: t("app_btn_cancel"),
                            icon: <StopOutlined />,
                            onClick: () =>
                                transferService.cancelBatch(record.id),
                        });
                    }
                }
                menuItems.push({
                    key: "delete",
                    label: t("app_btn_delete"),
                    danger: true,
                    icon: <DeleteOutlined />,
                    onClick: () => transferService.removeBatch(record.id),
                });
                return (
                    <Dropdown
                        menu={{ items: menuItems }}
                        trigger={["click"]}
                        placement="bottomRight"
                    >
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
            },
        },
    ];

    return (
        <Table<ITransferBatch>
            columns={columns}
            dataSource={list}
            rowKey="id"
            size="small"
            rowClassName="WebSSH-TransferRow"
            expandable={{
                expandedRowKeys: expanded,
                onExpand: async (isExpanded, record) => {
                    if (isExpanded && !items[record.id]) {
                        const response = await transferService.getBatchItems(
                            record.id,
                            undefined,
                            200,
                        );
                        setItems((current) => ({
                            ...current,
                            [record.id]: response.items,
                        }));
                    }
                    setExpanded((current) =>
                        isExpanded
                            ? [...current, record.id]
                            : current.filter((id) => id !== record.id),
                    );
                },
                expandedRowRender: (record) => (
                    <Table<ITransferTask>
                        columns={[
                            {
                                title: t("transfer_column_filename"),
                                dataIndex: "name",
                                key: "name",
                            },
                            {
                                title: t("transfer_column_progress"),
                                key: "progress",
                                render: (_, item) =>
                                    item.kind === "DIRECTORY"
                                        ? t(STATUS_TEXT_KEY[item.status])
                                        : `${item.loaded}/${item.total} (${Math.round(item.percent)}%)`,
                            },
                            {
                                title: t("transfer_status_running"),
                                dataIndex: "status",
                                key: "status",
                                render: (status: ITransferTask["status"]) =>
                                    t(STATUS_TEXT_KEY[status]),
                            },
                        ]}
                        dataSource={items[record.id] || []}
                        rowKey="id"
                        size="small"
                        pagination={false}
                    />
                ),
            }}
            pagination={{ pageSize: 10, showSizeChanger: true }}
        />
    );
};

export default function Transfer() {
    const { i18n, t } = useTranslation();
    const antdLocale = i18n.resolvedLanguage?.startsWith("en") ? enUS : zhCN;
    const [finishedHistoryCount, setFinishedHistoryCount] = useState(
        getFinishedHistoryCount,
    );

    useEffect(() => {
        const updateFinishedHistoryCount = () => {
            setFinishedHistoryCount(getFinishedHistoryCount());
        };
        const unsubscribeTasks = transferService.subscribe(
            updateFinishedHistoryCount,
        );
        const unsubscribeBatches = transferService.subscribeBatches(
            updateFinishedHistoryCount,
        );

        return () => {
            unsubscribeTasks();
            unsubscribeBatches();
        };
    }, []);

    const handleRemoveAll = () => {
        Modal.confirm({
            title: t("transfer_confirm_delete_all_title"),
            content: t("transfer_confirm_delete_all_content"),
            okText: t("app_btn_ok"),
            cancelText: t("app_btn_cancel"),
            okButtonProps: { danger: true },
            onOk: () => transferService.removeAll(),
        });
    };

    return (
        <ConfigProvider locale={antdLocale}>
            <Tabs
                className="WebSSH-Transfer"
                tabBarGutter={28}
                defaultActiveKey="all"
                tabBarExtraContent={
                    <Button
                        danger
                        disabled={finishedHistoryCount === 0}
                        icon={<DeleteOutlined />}
                        onClick={handleRemoveAll}
                    >
                        {t("transfer_action_delete_all_history")}
                    </Button>
                }
                items={[
                    {
                        key: "batches",
                        label: t("transfer_tab_batches"),
                        children: <BatchTable />,
                    },
                    {
                        key: "all",
                        label: t("transfer_tab_all"),
                        children: <TransferTable type="ALL" />,
                    },
                    {
                        key: "upload",
                        label: t("transfer_tab_upload"),
                        children: <TransferTable type="UPLOAD" />,
                    },
                    {
                        key: "download",
                        label: t("transfer_tab_download"),
                        children: <TransferTable type="DOWNLOAD" />,
                    },
                ]}
            />
        </ConfigProvider>
    );
}
