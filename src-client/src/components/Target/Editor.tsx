import { Button, Form, Input, InputNumber, Modal, Select } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import "./Editor.css";

import { postTargetAdd, postTargetUpdate } from "@/api";
import { validateCertContent } from "@/helpers/validateCertContent";

import InputTextFromFile from "../InputTextFromFile";

import type { ITarget } from "@/api";

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
    const { t } = useTranslation();

    const [form] = Form.useForm();
    const method = Form.useWatch("method", form);
    const [requirePassword, setRequirePassword] = useState(false);

    useEffect(() => {
        if (open && data) {
            form.setFieldsValue(data);
        } else {
            form.resetFields();
        }
    }, [data, open, form]);

    const onFinish = async () => {
        const values = await form.validateFields();
        if (data) {
            await postTargetUpdate(values);
        } else {
            await postTargetAdd(values);
        }
        onOk?.();
    };

    return (
        <Modal
            title={data ? t("target_edit") : t("target_new")}
            width={800}
            open={open}
            footer={null}
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
                <Form.Item
                    name="method"
                    label={t("target_method")}
                    rules={[{ required: true }]}
                >
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
                <Form.Item
                    name="host"
                    label={t("target_host")}
                    rules={[{ required: true }]}
                >
                    <Input placeholder="Host" />
                </Form.Item>
                <Form.Item
                    name="user"
                    label={t("target_user")}
                    rules={[{ required: true }]}
                >
                    <Input placeholder="Username" />
                </Form.Item>
                <Form.Item
                    name="key"
                    label={t("target_private_key")}
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
                                    ? Promise.reject(
                                          new Error("Invalid private key"),
                                      )
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
                    label={t("target_password")}
                    rules={[
                        {
                            required:
                                method === 1 ||
                                (method === 2 && requirePassword),
                        },
                    ]}
                >
                    <Input.Password placeholder={t("target_password")} />
                </Form.Item>
                <Form.Item name="port" label={t("target_port")}>
                    <InputNumber
                        min={1}
                        max={65535}
                        placeholder="22"
                        style={{ width: "100%" }}
                    />
                </Form.Item>
                <Form.Item name="system" label={t("target_system")}>
                    <Select
                        placeholder="Linux"
                        options={[
                            {
                                label: "Linux",
                                value: "",
                            },
                            {
                                label: "Windows",
                                value: "windows",
                            },
                        ]}
                    />
                </Form.Item>
                <Form.Item>
                    <Button type="primary" htmlType="submit">
                        {t("app_btn_save")}
                    </Button>
                </Form.Item>
            </Form>
        </Modal>
    );
}
