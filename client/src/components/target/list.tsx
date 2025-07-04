import { useEffect, useMemo, useState } from "react";
import { Button, Modal, Space, Table } from "antd";
import { useTranslation } from 'react-i18next';

import "./list.css";

import useAppStore from "@/store";
import { getTargetList, postTargetRemove } from "@/api";
import TargetEditor from "./editor";

import type { ColumnsType } from "antd/es/table/interface";
import type { ITab } from "@/store";
import type { ITarget } from "@/api";

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

    const columns: ColumnsType<ITarget> = useMemo(
        () => [
            {
                title: "User",
                dataIndex: "user",
                key: "user",
            },
            {
                title: "Host",
                dataIndex: "host",
                key: "host",
            },
            {
                title: "Port",
                dataIndex: "port",
                key: "port",
                width: 80,
            },
            {
                title: "Action",
                key: "action",
                render: (_, record) => (
                    <Space size="middle">
                        <a
                            onClick={() => {
                                setTabPath(tab.key, `/terminal/${record.id}`, `${record.user}@${record.host}`);
                            }}
                        >
                            SSH
                        </a>
                        <a
                            onClick={() => {
                                setTabPath(tab.key, `/filesview/${record.id}`, `${record.user}@${record.host}`);
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
                            Edit
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
                            Delete
                        </a>
                    </Space>
                ),
            },
        ],
        []
    );
    const [dataSource, setDataSource] = useState<ITarget[]>(mockData);

    useEffect(() => {
        refresh();
    }, []);

    return (
        <>
            <div className="targetListToolbar">
                <Button
                    onClick={() => {
                        setEditorData(undefined);
                        setEditorOpen(true);
                    }}
                >
                    {t('New target')}
                </Button>
                <Button onClick={refresh}>Refresh</Button>
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
