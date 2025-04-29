import { useEffect, useRef, useState } from "react";
import { Button, Form, Input, Modal, Select } from "antd";

import "./editor.css";

import InputTextFromFile from "../InputTextFromFile";

import { postTargetAdd, type ITarget } from "@/api";
import { validateCertContent } from "@/helpers/validate_cert_file";

export default function TargetEditor({
    data,
    open,
    onOk,
    onCancel,
}: {
    data?: ITarget;
    open?: boolean;
    onOk?: () => void;
    onCancel?: () => void;
}) {
    const rootElRef = useRef<HTMLDivElement>(null);

    const [form] = Form.useForm();
    const method = Form.useWatch('method', form);
    const [requirePassword, setRequirePassword] = useState(false);

    useEffect(() => {
        if (data) {
            form.setFieldsValue(data);
        } else {
            form.resetFields();
        }
    }, [data]);

    const onFinish = async () => {
        const values = await form.validateFields();
        await postTargetAdd(values);
        onOk?.();
    };

    return (
        <Modal
            title={data ? "Edit target" : "New target"}
            width={800}
            open={open}
            footer={null}
            getContainer={() => rootElRef.current!}
            onCancel={onCancel}
        >
            <Form
                form={form}
                autoComplete="off"
                className="targetEditorForm"
                layout="vertical"
                initialValues={{
                    method: 1,
                }}
                onFinish={onFinish}
            >
                <Form.Item name="id" hidden>
                    <Input hidden />
                </Form.Item>
                <Form.Item name="method" label="Method" rules={[{ required: true }]}>
                    <Select
                        options={[
                            {
                                label: "Password",
                                value: 1,
                            },
                            {
                                label: "Private key",
                                value: 2,
                            },
                        ]}
                    />
                </Form.Item>
                <Form.Item name="host" label="Host" rules={[{ required: true }]}>
                    <Input placeholder="Host" />
                </Form.Item>
                <Form.Item name="user" label="User" rules={[{ required: true }]}>
                    <Input placeholder="Username" />
                </Form.Item>
                <Form.Item
                    name="key"
                    label="Private key"
                    hidden={method === 1}
                    rules={[
                        { required: method === 2 },
                        {
                            validator: async (_, value) => {
                                if (!value) {
                                    setRequirePassword(false);
                                    return Promise.resolve();
                                }
                                if (value instanceof Error) {
                                    return Promise.reject(value.message);
                                }
                                const result = validateCertContent(value);
                                setRequirePassword(result === 2);
                                return result === 0
                                    ? Promise.reject(new Error("Invalid private key"))
                                    : Promise.resolve();
                            },
                        },
                    ]}
                >
                    <InputTextFromFile
                        maxFileSize={/* OpenSSH 限制密钥长度16KB */ 16384}
                        onReadFileFail={(err) => {
                            form.setFieldValue("key", err);
                            form.validateFields(["key"]);
                        }}
                    />
                </Form.Item>
                <Form.Item
                    name="password"
                    label="Password"
                    rules={[{ required: method === 1 || (method === 2 && requirePassword) }]}
                >
                    <Input.Password placeholder="Password" />
                </Form.Item>
                <Form.Item name="port" label="Port">
                    <Input placeholder="22" />
                </Form.Item>
                <Form.Item>
                    <Button type="primary" htmlType="submit">
                        Save
                    </Button>
                </Form.Item>
            </Form>
        </Modal>
    );
}
