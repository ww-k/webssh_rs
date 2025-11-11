import { Space, Table, Tabs } from "antd";

import "./index.css";

import useTransferStore from "@/services/transfer/store";

import type { TableProps } from "antd";
import type { ITransferListItem } from "@/services/transfer/store";

const columns: TableProps<ITransferListItem>["columns"] = [
    {
        title: "文件名",
        dataIndex: "name",
        key: "name",
        render: (text) => <a>{text}</a>,
    },
    {
        title: "状态",
        dataIndex: "status",
        key: "status",
    },
    {
        title: "Action",
        key: "action",
        render: (_, record) => (
            <Space size="middle">
                <a>Invite {record.name}</a>
                <a>Delete</a>
            </Space>
        ),
    },
];

export default function Transfer() {
    const list = useTransferStore((state) => state.list);
    return (
        <Tabs
            className="WebSSH-Transfer"
            type="card"
            items={[
                {
                    key: "upload",
                    label: "上传",
                    children: (
                        <Table<ITransferListItem>
                            columns={columns}
                            dataSource={list}
                        />
                    ),
                },
                {
                    key: "download",
                    label: "下载",
                    children: (
                        <Table<ITransferListItem>
                            columns={columns}
                            dataSource={list}
                        />
                    ),
                },
            ]}
        />
    );
}
