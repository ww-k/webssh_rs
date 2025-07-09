import { useMount } from "ahooks";
import { Button, Modal, Space, Table } from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getTargetList, postTargetRemove } from "@/api";
import useAppStore from "@/store";

import "./List.css";

import TargetEditor from "./Editor";

import type { ColumnsType } from "antd/es/table/interface";
import type { ITarget } from "@/api";
import type { ITab } from "@/store";

const mockData: ITarget[] = [
    {
        id: 1,
        host: "127.0.0.1",
        port: undefined,
        method: 1,
        user: "user1",
        key: "",
        password: "111111",
    },
    {
        id: 2,
        host: "127.0.0.1",
        port: undefined,
        method: 2,
        user: "user2",
        key: "123123",
        password: "222222",
    },
    {
        id: 3,
        host: "127.0.0.1",
        port: 2222,
        method: 1,
        user: "user3",
        key: "",
        password: "333333",
    },
];

export default function TargetList({ tab }: { tab: ITab }) {
    const { t } = useTranslation();
    const { setTabPath } = useAppStore();
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorData, setEditorData] = useState<ITarget>();

    async function refresh() {
        const res = await getTargetList();
        setDataSource(res);
    }

    // biome-ignore lint/correctness/useExhaustiveDependencies: 没用到可能变化的状态
    const columns: ColumnsType<ITarget> = useMemo(
        () => [
            {
                title: t("target_user"),
                dataIndex: "user",
                key: "user",
            },
            {
                title: t("target_host"),
                dataIndex: "host",
                key: "host",
            },
            {
                title: t("target_port"),
                dataIndex: "port",
                key: "port",
                width: 80,
            },
            {
                title: t("app_common_action"),
                key: "action",
                render: (_, record) => (
                    <Space size="middle">
                        <a
                            onClick={() => {
                                setTabPath(
                                    tab.key,
                                    `/terminal/${record.id}`,
                                    `${record.user}@${record.host}`,
                                );
                            }}
                        >
                            SSH
                        </a>
                        <a
                            onClick={() => {
                                setTabPath(
                                    tab.key,
                                    `/filesview/${record.id}`,
                                    `${record.user}@${record.host}`,
                                );
                            }}
                        >
                            SFTP
                        </a>
                        <a
                            onClick={() => {
                                setEditorData(record);
                                setEditorOpen(true);
                                refresh();
                            }}
                        >
                            {t("app_btn_edit")}
                        </a>
                        <a
                            onClick={() => {
                                Modal.confirm({
                                    content: "Confirm to delete?",
                                    async onOk() {
                                        await postTargetRemove(record.id);
                                        await refresh();
                                    },
                                });
                            }}
                        >
                            {t("app_btn_delete")}
                        </a>
                    </Space>
                ),
            },
        ],
        [],
    );
    const [dataSource, setDataSource] = useState<ITarget[]>(mockData);

    useMount(refresh);

    return (
        <>
            <div className="targetListToolbar">
                <Button
                    onClick={() => {
                        setEditorData(undefined);
                        setEditorOpen(true);
                    }}
                >
                    {t("target_new")}
                </Button>
                <Button onClick={refresh}>{t("app_btn_refresh")}</Button>
            </div>
            <Table
                className="targetListTable"
                rowKey="id"
                columns={columns}
                dataSource={dataSource}
                size="small"
                scroll={{ y: 390 }}
                pagination={false}
            />
            <TargetEditor
                open={editorOpen}
                data={editorData}
                onOk={() => {
                    refresh();
                    setEditorOpen(false);
                }}
                onCancel={() => setEditorOpen(false)}
            />
        </>
    );
}
