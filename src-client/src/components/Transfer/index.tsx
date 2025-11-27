import {
    DeleteOutlined,
    MoreOutlined,
    PauseCircleOutlined,
    PlayCircleOutlined,
    ReloadOutlined,
    StopOutlined,
} from "@ant-design/icons";
import {
    Button,
    Dropdown,
    Modal,
    Progress,
    Space,
    Table,
    Tabs,
    Tag,
    Tooltip,
    Typography,
} from "antd";

import "./index.css";

import transferService from "@/services/transfer";
import useTransferStore from "@/services/transfer/store";

import type { MenuProps, TableProps } from "antd";
import type { ITransferListItem } from "@/services/transfer/store";

const { Text } = Typography;

// 状态配置
const STATUS_CONFIG: Record<
    ITransferListItem["status"],
    { color: string; text: string }
> = {
    WAIT: { color: "default", text: "等待中" },
    RUN: { color: "processing", text: "传输中" },
    PAUSE: { color: "warning", text: "已暂停" },
    SUCCESS: { color: "success", text: "已完成" },
    FAIL: { color: "error", text: "失败" },
};

// 格式化文件大小
const formatSize = (bytes?: number): string => {
    if (!bytes) return "-";
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

// 格式化时间
const formatTime = (seconds?: number): string => {
    if (!seconds) return "-";
    if (seconds < 60) return `${Math.ceil(seconds)}秒`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)}分钟`;
    return `${Math.ceil(seconds / 3600)}小时`;
};

// 获取操作菜单项
const getActionMenuItems = (
    record: ITransferListItem,
    onPause: () => void,
    onResume: () => void,
    onCancel: () => void,
    onDelete: () => void,
): MenuProps["items"] => {
    const items: MenuProps["items"] = [];

    switch (record.status) {
        case "RUN":
            items.push({
                key: "pause",
                label: "暂停",
                icon: <PauseCircleOutlined />,
                onClick: onPause,
            });
            items.push({
                key: "cancel",
                label: "取消",
                icon: <StopOutlined />,
                onClick: onCancel,
            });
            break;
        case "PAUSE":
        case "WAIT":
            items.push({
                key: "resume",
                label: "恢复",
                icon: <PlayCircleOutlined />,
                onClick: onResume,
            });
            items.push({
                key: "cancel",
                label: "取消",
                icon: <StopOutlined />,
                onClick: onCancel,
            });
            break;
        case "FAIL":
            items.push({
                key: "retry",
                label: "重试",
                icon: <ReloadOutlined />,
                onClick: onResume,
            });
            break;
    }

    items.push({
        type: "divider",
    });

    items.push({
        key: "delete",
        label: "删除",
        icon: <DeleteOutlined />,
        danger: true,
        onClick: onDelete,
    });

    return items;
};

const TransferTable = ({ type }: { type: "UPLOAD" | "DOWNLOAD" }) => {
    const list = useTransferStore((state) => state.list);
    const {
        setPause,
        setResume,
        setSuccess,
        delete: deleteTask,
    } = useTransferStore();

    // 过滤特定类型的传输任务
    const filteredList = list.filter((item) => item.type === type);

    const handlePause = (record: ITransferListItem) => {
        setPause(record.id);
    };

    const handleResume = (record: ITransferListItem) => {
        if (record.status === "FAIL") {
            setSuccess(record.id); // 重置状态以便重新开始
        }
        setResume(record.id);
    };

    const handleCancel = (record: ITransferListItem) => {
        Modal.confirm({
            title: "确认取消",
            content: `确定要取消传输"${record.name}"吗？`,
            okText: "确定",
            cancelText: "取消",
            onOk: () => {
                transferService.remove(record.id);
            },
        });
    };

    const handleDelete = (record: ITransferListItem) => {
        Modal.confirm({
            title: "确认删除",
            content: `确定要删除任务"${record.name}"吗？`,
            okText: "确定",
            cancelText: "取消",
            onOk: () => {
                deleteTask(record.id);
            },
        });
    };

    const columns: TableProps<ITransferListItem>["columns"] = [
        {
            title: "文件名",
            dataIndex: "name",
            key: "name",
            width: "25%",
            ellipsis: true,
            render: (text) => (
                <Tooltip title={text}>
                    <Text>{text}</Text>
                </Tooltip>
            ),
        },
        {
            title: "状态",
            dataIndex: "status",
            key: "status",
            width: "10%",
            render: (status: ITransferListItem["status"]) => {
                const config = STATUS_CONFIG[status];
                return <Tag color={config.color}>{config.text}</Tag>;
            },
        },
        {
            title: "进度",
            key: "progress",
            width: "30%",
            render: (_, record) => {
                const { percent, loaded, size } = record;

                if (record.status === "SUCCESS") {
                    return (
                        <Space
                            size="small"
                            style={{ width: "100%" }}
                            orientation="vertical"
                        >
                            <Progress
                                percent={100}
                                size="small"
                                status="success"
                            />
                            <Text type="secondary" style={{ fontSize: "12px" }}>
                                {formatSize(size)} 已完成
                            </Text>
                        </Space>
                    );
                }

                if (record.status === "FAIL") {
                    return (
                        <Space
                            size="small"
                            style={{ width: "100%" }}
                            orientation="vertical"
                        >
                            <Progress
                                percent={Number((percent || 0).toFixed(2))}
                                size="small"
                                status="exception"
                            />
                            <Text type="danger" style={{ fontSize: "12px" }}>
                                {record.failReason || "传输失败"}
                            </Text>
                        </Space>
                    );
                }

                return (
                    <Space
                        size="small"
                        style={{ width: "100%" }}
                        orientation="vertical"
                    >
                        <Progress
                            percent={Number((percent || 0).toFixed(2))}
                            size="small"
                            status={
                                record.status === "PAUSE" ? "normal" : "active"
                            }
                        />
                        <Space>
                            <Text type="secondary" style={{ fontSize: "12px" }}>
                                {formatSize(loaded)}/{formatSize(size)}
                            </Text>
                            {record.speed && (
                                <Text
                                    type="secondary"
                                    style={{ fontSize: "12px" }}
                                >
                                    {formatSpeed(record.speed)}
                                </Text>
                            )}
                        </Space>
                    </Space>
                );
            },
        },
        {
            title: "剩余时间",
            dataIndex: "estimatedTime",
            key: "estimatedTime",
            width: "10%",
            align: "center",
            render: (estimatedTime, record) => {
                if (record.status === "SUCCESS") return "-";
                if (record.status === "FAIL") return "-";
                if (record.status === "PAUSE") return "已暂停";
                return formatTime(estimatedTime);
            },
        },
        {
            title: "操作",
            key: "action",
            width: "10%",
            align: "center",
            render: (_, record) => {
                const menuItems = getActionMenuItems(
                    record,
                    () => handlePause(record),
                    () => handleResume(record),
                    () => handleCancel(record),
                    () => handleDelete(record),
                );

                return (
                    <Dropdown
                        menu={{ items: menuItems }}
                        trigger={["click"]}
                        placement="bottomRight"
                    >
                        <Button type="text" icon={<MoreOutlined />} />
                    </Dropdown>
                );
            },
        },
    ];

    return (
        <Table<ITransferListItem>
            columns={columns}
            dataSource={filteredList}
            rowKey="id"
            size="small"
            pagination={{
                pageSize: 10,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total) => `共 ${total} 个任务`,
            }}
        />
    );
};

export default function Transfer() {
    return (
        <Tabs
            className="WebSSH-Transfer"
            type="card"
            items={[
                {
                    key: "upload",
                    label: "上传",
                    children: <TransferTable type="UPLOAD" />,
                },
                {
                    key: "download",
                    label: "下载",
                    children: <TransferTable type="DOWNLOAD" />,
                },
            ]}
        />
    );
}
