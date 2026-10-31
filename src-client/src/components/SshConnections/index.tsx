import {
    CloseCircleOutlined,
    DisconnectOutlined,
    ReloadOutlined,
} from "@ant-design/icons";
import {
    Button,
    Empty,
    message,
    Popconfirm,
    Space,
    Table,
    Tag,
    Tooltip,
    Typography,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { TableProps } from "antd";

import "./index.css";

import {
    getSshConnectionList,
    getTargetList,
    postSshConnectionClose,
    postSshConnectionExpire,
} from "@/api";
import getTargetName from "@/components/Target/getTargetName";

import type { ISshConnection, ITarget } from "@/api";

const { Text } = Typography;

export default function SshConnections() {
    const { t } = useTranslation();
    const [connections, setConnections] = useState<ISshConnection[]>([]);
    const [targets, setTargets] = useState<ITarget[]>([]);
    const [loading, setLoading] = useState(false);
    const [actionKey, setActionKey] = useState<string>();
    const tableContainerRef = useRef<HTMLDivElement>(null);
    const [tableBodyHeight, setTableBodyHeight] = useState(0);

    const loadConnections = useCallback(async () => {
        setLoading(true);
        try {
            const [connectionList, targetList] = await Promise.all([
                getSshConnectionList(),
                getTargetList(),
            ]);
            setConnections(connectionList);
            setTargets(targetList);
        } catch {
            message.error(t("ssh_connections_load_failed"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void loadConnections();
    }, [loadConnections]);

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
    }, []);

    const runAction = useCallback(
        async (connection: ISshConnection, action: "expire" | "close") => {
            const key = `${action}:${connection.id}`;
            setActionKey(key);
            try {
                const params = {
                    target_id: connection.target_id,
                    connection_id: connection.id,
                };
                if (action === "expire") {
                    await postSshConnectionExpire(params);
                    message.success(t("ssh_connections_expire_success"));
                } else {
                    await postSshConnectionClose(params);
                    message.success(t("ssh_connections_close_success"));
                }
                await loadConnections();
            } catch {
                message.error(
                    action === "expire"
                        ? t("ssh_connections_expire_failed")
                        : t("ssh_connections_close_failed"),
                );
            } finally {
                setActionKey(undefined);
            }
        },
        [loadConnections, t],
    );

    const columns: TableProps<ISshConnection>["columns"] = [
        {
            title: t("ssh_connections_column_id"),
            dataIndex: "id",
            render: (id: string) => (
                <Text code copyable={{ text: id }}>
                    {id}
                </Text>
            ),
        },
        {
            title: t("ssh_connections_column_target"),
            dataIndex: "target_id",
            render: (targetId: number) => {
                const target = targets.find((item) => item.id === targetId);
                return target ? getTargetName(target) : targetId;
            },
        },
        {
            title: t("ssh_connections_column_channels"),
            key: "active_channels",
            width: 80,
            render: (_, connection) => connection.active_channels ?? 0,
        },
        {
            title: t("ssh_connections_column_status"),
            width: 80,
            render: (_, connection) => {
                const color = connection.closed
                    ? "default"
                    : connection.expired
                      ? "warning"
                      : "success";
                const label = connection.closed
                    ? t("ssh_connections_status_closed")
                    : connection.expired
                      ? t("ssh_connections_status_expiring")
                      : t("ssh_connections_status_active");
                return <Tag color={color}>{label}</Tag>;
            },
        },
        {
            title: t("app_common_action"),
            key: "actions",
            width: 100,
            render: (_, connection) => (
                <Space size="small">
                    {!connection.expired && !connection.closed && (
                        <Tooltip title={t("ssh_connections_expire")}>
                            <Button
                                aria-label={t("ssh_connections_expire")}
                                icon={<DisconnectOutlined />}
                                loading={
                                    actionKey === `expire:${connection.id}`
                                }
                                onClick={() =>
                                    void runAction(connection, "expire")
                                }
                                size="small"
                                type="text"
                            />
                        </Tooltip>
                    )}
                    {!connection.closed && (
                        <Popconfirm
                            title={t("ssh_connections_close_confirm")}
                            onConfirm={() =>
                                void runAction(connection, "close")
                            }
                            okText={t("app_btn_ok")}
                            cancelText={t("app_btn_cancel")}
                        >
                            <Tooltip title={t("ssh_connections_close")}>
                                <Button
                                    aria-label={t("ssh_connections_close")}
                                    danger
                                    icon={<CloseCircleOutlined />}
                                    loading={
                                        actionKey === `close:${connection.id}`
                                    }
                                    size="small"
                                    type="text"
                                />
                            </Tooltip>
                        </Popconfirm>
                    )}
                </Space>
            ),
        },
    ];

    return (
        <main className="WebSSH-MenuPage WebSSH-SshConnections">
            <div className="WebSSH-MenuPageToolbar WebSSH-SshConnections-Header">
                <Tooltip title={t("app_btn_refresh")}>
                    <Button
                        aria-label={t("app_btn_refresh")}
                        icon={<ReloadOutlined />}
                        loading={loading}
                        onClick={() => void loadConnections()}
                    />
                </Tooltip>
            </div>
            <div className="WebSSH-MenuPageContent WebSSH-MenuPageContent--scroll">
                <div
                    ref={tableContainerRef}
                    className="WebSSH-SshConnections-TableContainer"
                >
                    <Table<ISshConnection>
                        className="WebSSH-FilelistTable WebSSH-SshConnections-Table"
                        columns={columns}
                        dataSource={connections}
                        loading={loading}
                        rowKey="id"
                        locale={{
                            emptyText: (
                                <Empty
                                    description={t("ssh_connections_empty")}
                                />
                            ),
                        }}
                        pagination={false}
                        virtual={tableBodyHeight > 0}
                        scroll={
                            tableBodyHeight > 0
                                ? { x: 760, y: tableBodyHeight }
                                : undefined
                        }
                        size="small"
                    />
                </div>
            </div>
        </main>
    );
}
