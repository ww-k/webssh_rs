import { ReloadOutlined } from "@ant-design/icons";
import { useMount } from "ahooks";
import { Button, Input, Modal, Space, Table } from "antd";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getTargetList, postTargetRemove } from "@/api";
import useAppStore from "@/store";

import "./List.css";

import TargetEditor from "./Editor";

import type { ColumnsType } from "antd/es/table/interface";
import type { ITarget } from "@/api";
import type { ITab } from "@/store";

function getTargetName(target: ITarget): string {
    return (
        target.name ||
        `${target.user}@${target.host}${target.port ? `:${target.port}` : ""}`
    );
}

export default function TargetList({ tab }: { tab: ITab }) {
    const { t } = useTranslation();
    const { setTabPath } = useAppStore();
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorData, setEditorData] = useState<ITarget>();
    const [dataSource, setDataSource] = useState<ITarget[]>([]);
    const [searchValue, setSearchValue] = useState("");

    const filteredDataSource = useMemo(() => {
        const search = searchValue.trim().toLocaleLowerCase();
        if (!search) {
            return dataSource;
        }

        return dataSource.filter((target) =>
            [target.name, target.user, target.host].some((value) =>
                value?.toLocaleLowerCase().includes(search),
            ),
        );
    }, [dataSource, searchValue]);

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
                render: (_, record) => getTargetName(record),
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
                                    `ssh ${getTargetName(record)}`,
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
                                    `sftp ${getTargetName(record)}`,
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
                <Space>
                    <Button
                        onClick={() => {
                            setEditorData(undefined);
                            setEditorOpen(true);
                        }}
                    >
                        {t("target_new")}
                    </Button>
                </Space>
                <Space className="targetListSearch">
                    <Input
                        allowClear
                        onChange={(event) => setSearchValue(event.target.value)}
                        placeholder={t("target_search_placeholder")}
                        value={searchValue}
                    />
                    <Button
                        aria-label={t("app_btn_refresh")}
                        icon={<ReloadOutlined />}
                        onClick={refresh}
                        title={t("app_btn_refresh")}
                    />
                </Space>
            </div>
            <Table
                className="targetListTable"
                rowKey="id"
                columns={columns}
                dataSource={filteredDataSource}
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
