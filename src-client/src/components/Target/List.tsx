import { useMount } from "ahooks";
import { Button, Modal, Space, Table } from "antd";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getTargetList, postTargetRemove } from "@/api";
import useAppStore from "@/store";

import "./List.css";

import TargetEditor from "./Editor";

import type { ColumnsType } from "antd/es/table/interface";
import type { ITarget } from "@/api";
import type { ITab } from "@/store";

export default function TargetList({ tab }: { tab: ITab }) {
    const { t } = useTranslation();
    const { setTabPath } = useAppStore();
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorData, setEditorData] = useState<ITarget>();
    const [dataSource, setDataSource] = useState<ITarget[]>([]);

    const refresh = useCallback(async () => {
        const res = await getTargetList();
        setDataSource(res);
    }, []);

    const columns: ColumnsType<ITarget> = useMemo(
        () => [
            {
                title: t("target_name"),
                dataIndex: "name",
                key: "name",
                render: (name: string | undefined, record) =>
                    name ||
                    `${record.user}@${record.host}${record.port ? `:${record.port}` : ""}`,
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
        [refresh, setTabPath, t, tab.key],
    );

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
