import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Form, Input, Modal, Space, Table } from "antd";

import "./editor.css";

import useAppStore from "@/store";

import type { ITarget } from "@/api";

export default function TargetEditor({
    data,
    open,
    onCancel,
}: {
    data?: ITarget;
    open?: boolean;
    onCancel?: () => void;
}) {
    const rootElRef = useRef<HTMLDivElement>(null);

    const [form] = Form.useForm();

    const onFinish = (values: any) => {
        console.log("Finish:", values);
    };

    return (
        <Modal
            title="Edit target"
            width={800}
            open={open}
            footer={null}
            getContainer={() => rootElRef.current!}
            onCancel={onCancel}
        >
            <Form form={form} className="targetEditorForm" layout="vertical" onFinish={onFinish}>
                <Form.Item name="host" label="Host" rules={[{ required: true, message: "Please input your host!" }]}>
                    <Input placeholder="Host" />
                </Form.Item>
                <Form.Item
                    name="username"
                    label="Username"
                    rules={[{ required: true, message: "Please input your username!" }]}
                >
                    <Input placeholder="Username" />
                </Form.Item>
                <Form.Item name="keyName" label="Key">
                    <Input type="file" placeholder="Key name" />
                </Form.Item>
                <Form.Item name="password" label="Password">
                    <Input type="password" placeholder="Password" />
                </Form.Item>
                <Form.Item name="port" label="Port">
                    <Input placeholder="22" />
                </Form.Item>
                <Form.Item shouldUpdate>
                    {() => (
                        <Button
                            type="primary"
                            htmlType="submit"
                            disabled={
                                !form.isFieldsTouched(true) ||
                                !!form.getFieldsError().filter(({ errors }) => errors.length).length
                            }
                        >
                            Save and connect
                        </Button>
                    )}
                </Form.Item>
            </Form>
        </Modal>
    );
}
