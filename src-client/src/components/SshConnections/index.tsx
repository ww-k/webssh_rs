import {
    CloseCircleOutlined,
    DisconnectOutlined,
    ReloadOutlined,
} from "@ant-design/icons";
import {
    Button,
    message,
    Popconfirm,
    Space,
    Tag,
    Tooltip,
    Typography,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import "./index.css";

import {
    getSshConnectionList,
    getTargetList,
    postSshConnectionClose,
    postSshConnectionExpire,
} from "@/api";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import getTargetName from "@/components/Target/getTargetName";

import type { ISshConnection, ITarget } from "@/api";

const { Text } = Typography;

export default function SshConnections() {
    const { t } = useTranslation();
    const [connections, setConnections] = useState<ISshConnection[]>([]);
    const [targets, setTargets] = useState<ITarget[]>([]);
    const [loading, setLoading] = useState(false);
    const [actionKey, setActionKey] = useState<string>();

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

    const columns: DataTableColumn<ISshConnection>[] = useMemo(
        () => [
            {
                id: "id",
                header: t("ssh_connections_column_id"),
                accessor: (connection) => connection.id,
                width: 260,
                cell: (value) => {
                    const id = String(value ?? "");
                    return (
                        <Text code copyable={{ text: id }}>
                            {id}
                        </Text>
                    );
                },
            },
            {
                id: "target",
                header: t("ssh_connections_column_target"),
                accessor: (connection) => connection.target_id,
                cell: (value) => {
                    const targetId = Number(value);
                    const target = targets.find((item) => item.id === targetId);
                    return target ? getTargetName(target) : targetId;
                },
            },
            {
                id: "active_channels",
                header: t("ssh_connections_column_channels"),
                accessor: (connection) => connection.active_channels ?? 0,
                width: 80,
                align: "right",
            },
            {
                id: "status",
                header: t("ssh_connections_column_status"),
                accessor: (connection) =>
                    connection.closed ? 2 : connection.expired ? 1 : 0,
                width: 80,
                cell: (_, connection) => {
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
                id: "actions",
                header: t("app_common_action"),
                accessor: () => "",
                width: 100,
                sortable: false,
                cell: (_, connection) => (
                    <Space size="small">
                        <Tooltip title={t("ssh_connections_expire")}>
                            <Button
                                aria-label={t("ssh_connections_expire")}
                                disabled={
                                    connection.expired || connection.closed
                                }
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
                        <Popconfirm
                            disabled={connection.closed}
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
                                    disabled={connection.closed}
                                    icon={<CloseCircleOutlined />}
                                    loading={
                                        actionKey === `close:${connection.id}`
                                    }
                                    size="small"
                                    type="text"
                                />
                            </Tooltip>
                        </Popconfirm>
                    </Space>
                ),
            },
        ],
        [actionKey, runAction, t, targets],
    );

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
                <DataTable
                    className="WebSSH-SshConnections-Table"
                    columns={columns}
                    data={connections}
                    emptyContent={t("ssh_connections_empty")}
                    getRowId={(connection) => connection.id}
                    loading={loading}
                    rowHeight={33}
                    selectable={false}
                    virtual
                />
            </div>
        </main>
    );
}
