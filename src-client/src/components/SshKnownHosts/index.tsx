import { DeleteOutlined, KeyOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Empty, message, Popconfirm, Table, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getSshKnownHostList, postSshKnownHostRemove } from "@/api";

import type { TableProps } from "antd";
import type { ISshKnownHost } from "@/api";

import "./index.css";

const { Text, Title } = Typography;

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

    const columns: TableProps<ISshKnownHost>["columns"] = [
        {
            title: t("ssh_known_hosts_column_host"),
            key: "host",
            width: 160,
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
                    ellipsis={{ tooltip: fingerprint }}>
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
                    <Button
                        danger
                        icon={<DeleteOutlined />}
                        loading={removingId === knownHost.id}
                        size="small"
                    >
                        {t("app_btn_delete")}
                    </Button>
                </Popconfirm>
            ),
        },
    ];

    return (
        <main className="WebSSH-SshKnownHosts">
            <div className="WebSSH-SshKnownHosts-Header">
                <div>
                    <Title level={2}>{t("app_menu_ssh_known_hosts")}</Title>
                </div>
                <Button
                    icon={<ReloadOutlined />}
                    loading={loading}
                    onClick={() => void loadKnownHosts(true)}
                >
                    {t("app_btn_refresh")}
                </Button>
            </div>
            <Table<ISshKnownHost>
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
                scroll={{ x: 900 }}
                size="small"
            />
        </main>
    );
}
