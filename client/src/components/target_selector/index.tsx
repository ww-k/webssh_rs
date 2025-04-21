import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Space, Table } from "antd";

import "./index.css";

import useAppStore from "@/store";

import type { ColumnsType } from "antd/es/table/interface";
import type { ITab } from "@/store";

interface DataType {
    id: number;
    host: string;
    port: number;
    method: number;
    user: string;
    key: string;
    password: string;
}

const data: DataType[] = [
    {
        id: 1,
        host: "127.0.0.1",
        port: 22,
        method: 1,
        user: "user1",
        key: "",
        password: "",
    },
    {
        id: 2,
        host: "127.0.0.1",
        port: 22,
        method: 1,
        user: "user2",
        key: "",
        password: "",
    },
    {
        id: 3,
        host: "127.0.0.1",
        port: 22,
        method: 1,
        user: "user3",
        key: "",
        password: "",
    },
];

export default function TargetSelector({ tab }: { tab: ITab }) {
    const { setTabPath } = useAppStore();
    const rootElRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);

    const columns: ColumnsType<DataType> = useMemo(
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
            },
            {
                title: "Action",
                key: "action",
                render: (_, record) => (
                    <Space size="middle">
                        <a
                            onClick={() => {
                                setTabPath(tab.key, `/terminal/${record.id}`);
                            }}
                        >
                            Connect
                        </a>
                        <a>Delete</a>
                    </Space>
                ),
            },
        ],
        []
    );

    useEffect(() => {
        if (rootElRef.current) {
            setOpen(true);
        }
    }, []);

    return (
        <div className="targetSelector" ref={rootElRef}>
            <Modal
                title="Select target"
                open={open}
                transitionName=""
                maskTransitionName=""
                footer={null}
                mask={false}
                closable={false}
                getContainer={() => rootElRef.current!}
            >
                <Table columns={columns} dataSource={data} />
            </Modal>
        </div>
    );
}
