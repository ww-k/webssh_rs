import {
    CodeOutlined,
    DeleteOutlined,
    EditOutlined,
    FolderOpenOutlined,
    ReloadOutlined,
} from "@ant-design/icons";
import { Button, Input, Modal, Space, Table, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
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

export default function TargetList({
    tab,
    refreshKey,
}: {
    tab: ITab;
    refreshKey?: number;
}) {
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
                width: 180,
                render: (_, record) => (
                    <Space size="small">
                        <Tooltip title="SSH">
                            <Button
                                aria-label="SSH"
                                icon={<CodeOutlined />}
                                type="text"
                                onClick={() => {
                                    setTabPath(
                                        tab.key,
                                        `/terminal/${record.id}`,
                                        `${getTargetName(record)}`,
                                    );
                                }}
                            />
                        </Tooltip>
                        <Tooltip title="SFTP">
                            <Button
                                aria-label="SFTP"
                                icon={<FolderOpenOutlined />}
                                type="text"
                                onClick={() => {
                                    setTabPath(
                                        tab.key,
                                        `/filesview/${record.id}`,
                                        `${getTargetName(record)}`,
                                    );
                                }}
                            />
                        </Tooltip>
                        <Tooltip title={t("app_btn_edit")}>
                            <Button
                                aria-label={t("app_btn_edit")}
                                icon={<EditOutlined />}
                                type="text"
                                onClick={() => {
                                    setEditorData(record);
                                    setEditorOpen(true);
                                    refresh();
                                }}
                            />
                        </Tooltip>
                        <Tooltip title={t("app_btn_delete")}>
                            <Button
                                aria-label={t("app_btn_delete")}
                                danger
                                icon={<DeleteOutlined />}
                                type="text"
                                onClick={() => {
                                    Modal.confirm({
                                        content: "Confirm to delete?",
                                        async onOk() {
                                            await postTargetRemove(record.id);
                                            await refresh();
                                        },
                                    });
                                }}
                            />
                        </Tooltip>
                    </Space>
                ),
            },
        ],
        [refresh, setTabPath, t, tab.key],
    );

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        if (refreshKey && refreshKey > 0) {
            void refresh();
        }
    }, [refresh, refreshKey]);

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
