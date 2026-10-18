import { Button, Card, Form, Input, InputNumber } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { postTargetAdd } from "@/api";
import useAppStore from "@/store";
import "./Selector.css";

import TargetList from "./List";

import type { FormProps } from "antd";
import type { ITab } from "@/store";

export default function TargetSelector({ tab }: { tab: ITab }) {
    const { t } = useTranslation();
    const [form] = Form.useForm();
    const [refreshKey, setRefreshKey] = useState(0);
    const addTab = useAppStore((state) => state.addTab);
    const setTabPath = useAppStore((state) => state.setTabPath);

    const onFinish: FormProps["onFinish"] = async (values) => {
        const target = await postTargetAdd({
            ...values,
            method: 1,
        });
        setRefreshKey((key) => key + 1);
        form.resetFields();

        const terminalTabKey = addTab();
        const targetName =
            target.name ||
            `${target.user}@${target.host}${target.port ? `:${target.port}` : ""}`;
        setTabPath(
            terminalTabKey,
            `/terminal/${target.id}`,
            `ssh ${targetName}`,
        );
    };

    const onFinishFailed: FormProps["onFinishFailed"] = ({
        values,
        errorFields,
        outOfDate,
    }) => {
        console.log("onFinishFailed:", values, errorFields, outOfDate);
    };

    return (
        <div className="targetSelector">
            <Card className="targetSelectorCard" title={t("target_select")}>
                <Form
                    form={form}
                    autoComplete="off"
                    className="targetSelectorAddForm"
                    layout="inline"
                    onFinish={onFinish}
                    onFinishFailed={onFinishFailed}
                >
                    <Form.Item
                        name="host"
                        style={{ width: 200 }}
                        rules={[{ required: true }]}
                    >
                        <Input placeholder={t("target_host")} />
                    </Form.Item>
                    <Form.Item name="user" rules={[{ required: true }]}>
                        <Input
                            autoComplete="new-password"
                            placeholder={t("target_user")}
                            style={{ width: 120 }}
                        />
                    </Form.Item>
                    <Form.Item name="password">
                        <Input.Password
                            autoComplete="new-password"
                            placeholder={t("target_password")}
                            style={{ width: 120 }}
                        />
                    </Form.Item>
                    <Form.Item name="port">
                        <InputNumber
                            min={1}
                            max={65535}
                            placeholder="22"
                            style={{ width: 68 }}
                        />
                    </Form.Item>
                    <Form.Item shouldUpdate>
                        <Button type="primary" htmlType="submit">
                            {t("target_save_and_connect")}
                        </Button>
                    </Form.Item>
                </Form>
                <TargetList tab={tab} refreshKey={refreshKey} />
            </Card>
        </div>
    );
}
