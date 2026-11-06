import { DeleteOutlined, KeyOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, message, Popconfirm, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getSshKnownHostList, postSshKnownHostRemove } from "@/api";
import DataTable, { type DataTableColumn } from "@/components/DataTable";

import type { ISshKnownHost } from "@/api";

import "./index.css";

const { Text } = Typography;

export default function SshKnownHosts() {
    const { t } = useTranslation();
    const [knownHosts, setKnownHosts] = useState<ISshKnownHost[]>([]);
    const [loading, setLoading] = useState(false);
    const [removingId, setRemovingId] = useState<number>();

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

    const columns: DataTableColumn<ISshKnownHost>[] = useMemo(
        () => [
            {
                id: "host",
                header: t("ssh_known_hosts_column_host"),
                accessor: (knownHost) => `${knownHost.host}:${knownHost.port}`,
                width: 220,
            },
            {
                id: "algorithm",
                header: t("ssh_known_hosts_column_algorithm"),
                accessor: (knownHost) => knownHost.key_algorithm,
                width: 140,
            },
            {
                id: "fingerprint",
                header: t("ssh_known_hosts_column_fingerprint"),
                accessor: (knownHost) => knownHost.fingerprint,
                cell: (value) => {
                    const fingerprint = String(value ?? "");
                    return (
                        <Text
                            code
                            copyable={{ text: fingerprint }}
                            ellipsis={{ tooltip: fingerprint }}
                        >
                            {fingerprint}
                        </Text>
                    );
                },
                width: 300,
            },
            {
                id: "public_key",
                header: t("ssh_known_hosts_column_public_key"),
                accessor: (knownHost) => knownHost.public_key,
                cell: (value) => {
                    const publicKey = String(value ?? "");
                    return (
                        <Text
                            code
                            copyable={{ text: publicKey }}
                            ellipsis={{ tooltip: publicKey }}
                        >
                            {publicKey}
                        </Text>
                    );
                },
            },
            {
                id: "actions",
                header: t("app_common_action"),
                accessor: () => "",
                width: 100,
                sortable: false,
                cell: (_, knownHost) => (
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
        ],
        [removeKnownHost, removingId, t],
    );

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
                <DataTable
                    className="WebSSH-SshKnownHosts-Table"
                    columns={columns}
                    data={knownHosts}
                    emptyContent={
                        <span>
                            <KeyOutlined /> {t("ssh_known_hosts_empty")}
                        </span>
                    }
                    getRowId={(knownHost) => String(knownHost.id)}
                    loading={loading}
                    rowHeight={33}
                    selectable={false}
                    virtual
                />
            </div>
        </main>
    );
}
