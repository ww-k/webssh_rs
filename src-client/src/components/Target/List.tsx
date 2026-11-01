import {
    CodeOutlined,
    DeleteOutlined,
    EditOutlined,
    FolderOutlined,
    PlusCircleTwoTone,
    ReloadOutlined,
    SearchOutlined,
} from "@ant-design/icons";
import { Button, Input, Modal, Space, Table, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getTargetList, postTargetRemove } from "@/api";
import useTablePageNavigation from "@/hooks/useTablePageNavigation";
import useAppStore from "@/store";

import "./List.css";

import TargetEditor from "./Editor";
import getTargetName from "./getTargetName";

import type { ColumnsType } from "antd/es/table/interface";
import type { ITarget } from "@/api";
import type { ITab } from "@/store";

export default function TargetList({ tab }: { tab: ITab }) {
    const { t } = useTranslation();
    const { setTabPath } = useAppStore();
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorData, setEditorData] = useState<ITarget>();
    const [dataSource, setDataSource] = useState<ITarget[]>([]);
    const [searchValue, setSearchValue] = useState("");
    const {
        tableContainerRef,
        tablePageNavigationProps,
    } = useTablePageNavigation();
    const [tableBodyHeight, setTableBodyHeight] = useState(0);

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
                                icon={<FolderOutlined />}
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

    return (
        <>
            <div className="WebSSH-MenuPageToolbar targetListToolbar">
                <Input
                    allowClear
                    aria-label={t("transfer_filter_keyword")}
                    className="WebSSH-TransferKeyword targetListSearch"
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder={t("transfer_filter_keyword")}
                    prefix={<SearchOutlined />}
                    value={searchValue}
                />
                <Space className="targetListActions" size="small">
                    <Tooltip title={t("target_new")}>
                        <Button
                            icon={<PlusCircleTwoTone />}
                            onClick={() => {
                                setEditorData(undefined);
                                setEditorOpen(true);
                            }}
                        />
                    </Tooltip>
                    <Tooltip title={t("app_btn_refresh")}>
                        <Button
                            aria-label={t("app_btn_refresh")}
                            icon={<ReloadOutlined />}
                            onClick={refresh}
                            title={t("app_btn_refresh")}
                        />
                    </Tooltip>
                </Space>
            </div>
            <div
                ref={tableContainerRef}
                className="WebSSH-MenuPageContent targetListTableContainer"
                {...tablePageNavigationProps}
            >
                <Table
                    className="WebSSH-FilelistTable targetListTable"
                    rowKey="id"
                    columns={columns}
                    dataSource={filteredDataSource}
                    size="small"
                    pagination={false}
                    virtual={tableBodyHeight > 0}
                    scroll={
                        tableBodyHeight > 0
                            ? { x: 520, y: tableBodyHeight }
                            : undefined
                    }
                />
            </div>
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
