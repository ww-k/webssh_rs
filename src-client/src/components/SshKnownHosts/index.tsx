import { DeleteOutlined, KeyOutlined, ReloadOutlined } from "@ant-design/icons";
import {
    Button,
    Empty,
    message,
    Popconfirm,
    Table,
    Tooltip,
    Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getSshKnownHostList, postSshKnownHostRemove } from "@/api";
import useTablePageNavigation from "@/hooks/useTablePageNavigation";

import type { TableProps } from "antd";
import type { ISshKnownHost } from "@/api";

import "./index.css";

const { Text } = Typography;

export default function SshKnownHosts() {
    const { t } = useTranslation();
    const [knownHosts, setKnownHosts] = useState<ISshKnownHost[]>([]);
    const [loading, setLoading] = useState(false);
    const [removingId, setRemovingId] = useState<number>();
    const {
        tableContainerRef,
        tablePageNavigationProps,
    } = useTablePageNavigation();
    const [tableBodyHeight, setTableBodyHeight] = useState(0);

    const loadKnownHosts = useCallback(
        async (showError = false) => {
            setLoading(true);
            try {
                setKnownHosts(await getSshKnownHostList());
            } catch {
                if (showError) message.error(t("ssh_known_hosts_load_failed"));
            } finally {
                setLoading(false);
            }
        },
        [t],
    );

    useEffect(() => {
        void loadKnownHosts();
    }, [loadKnownHosts]);

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

    const removeKnownHost = useCallback(
        async (knownHost: ISshKnownHost) => {
            setRemovingId(knownHost.id);
            try {
                await postSshKnownHostRemove(knownHost.id);
                message.success(t("ssh_known_hosts_remove_success"));
                await loadKnownHosts();
            } catch {
                message.error(t("ssh_known_hosts_remove_failed"));
            } finally {
                setRemovingId(undefined);
            }
        },
        [loadKnownHosts, t],
    );

    const columns: TableProps<ISshKnownHost>["columns"] = [
        {
            title: t("ssh_known_hosts_column_host"),
            key: "host",
            render: (_, knownHost) => `${knownHost.host}:${knownHost.port}`,
        },
        {
            title: t("ssh_known_hosts_column_algorithm"),
            dataIndex: "key_algorithm",
            width: 140,
        },
        {
            title: t("ssh_known_hosts_column_fingerprint"),
            dataIndex: "fingerprint",
            render: (fingerprint: string) => (
                <Text
                    code
                    copyable={{ text: fingerprint }}
                    ellipsis={{ tooltip: fingerprint }}
                >
                    {fingerprint}
                </Text>
            ),
        },
        {
            title: t("ssh_known_hosts_column_public_key"),
            dataIndex: "public_key",
            ellipsis: true,
            render: (publicKey: string) => (
                <Text
                    code
                    copyable={{ text: publicKey }}
                    ellipsis={{ tooltip: publicKey }}
                >
                    {publicKey}
                </Text>
            ),
        },
        {
            title: t("app_common_action"),
            key: "actions",
            width: 100,
            render: (_, knownHost) => (
                <Popconfirm
                    title={t("ssh_known_hosts_remove_confirm")}
                    onConfirm={() => void removeKnownHost(knownHost)}
                    okText={t("app_btn_ok")}
                    cancelText={t("app_btn_cancel")}
                >
                    <Tooltip title={t("app_btn_delete")}>
                        <Button
                            aria-label={t("app_btn_delete")}
                            danger
                            icon={<DeleteOutlined />}
                            loading={removingId === knownHost.id}
                            size="small"
                            type="text"
                        />
                    </Tooltip>
                </Popconfirm>
            ),
        },
    ];

    return (
        <main className="WebSSH-MenuPage WebSSH-SshKnownHosts">
            <div className="WebSSH-MenuPageToolbar WebSSH-SshKnownHosts-Header">
                <Tooltip title={t("app_btn_refresh")}>
                    <Button
                        aria-label={t("app_btn_refresh")}
                        icon={<ReloadOutlined />}
                        loading={loading}
                        onClick={() => void loadKnownHosts(true)}
                    />
                </Tooltip>
            </div>
            <div className="WebSSH-MenuPageContent WebSSH-MenuPageContent--scroll">
                <div
                    ref={tableContainerRef}
                    className="WebSSH-SshKnownHosts-TableContainer"
                    {...tablePageNavigationProps}
                >
                    <Table<ISshKnownHost>
                        className="WebSSH-FilelistTable WebSSH-SshKnownHosts-Table"
                        columns={columns}
                        dataSource={knownHosts}
                        loading={loading}
                        rowKey="id"
                        locale={{
                            emptyText: (
                                <Empty
                                    image={<KeyOutlined />}
                                    description={t("ssh_known_hosts_empty")}
                                />
                            ),
                        }}
                        pagination={false}
                        virtual={tableBodyHeight > 0}
                        scroll={
                            tableBodyHeight > 0
                                ? { x: 900, y: tableBodyHeight }
                                : undefined
                        }
                        size="small"
                    />
                </div>
            </div>
        </main>
    );
}
