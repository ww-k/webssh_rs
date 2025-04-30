import { Button, Card, Form, FormProps, Input, InputNumber } from "antd";

import "./selector.css";

import TargetList from "./list";

import type { ITab } from "@/store";
import { postTargetAdd } from "@/api";

export default function TargetSelector({ tab }: { tab: ITab }) {
    const [form] = Form.useForm();

    const onFinish: FormProps["onFinish"] = async (values) => {
        await postTargetAdd({
            ...values,
            method: 1,
        });
    };

    const onFinishFailed: FormProps["onFinishFailed"] = ({ values, errorFields, outOfDate }) => {
        console.log("onFinishFailed:", values, errorFields, outOfDate);
    };

    return (
        <div className="targetSelector">
            <Card style={{ width: 800 }} title="Select target">
                <Form
                    form={form}
                    autoComplete="off"
                    className="targetSelectorAddForm"
                    layout="inline"
                    onFinish={onFinish}
                    onFinishFailed={onFinishFailed}
                >
                    <Form.Item name="host" style={{ width: 200 }} rules={[{ required: true }]}>
                        <Input placeholder="Host" />
                    </Form.Item>
                    <Form.Item name="user" rules={[{ required: true }]}>
                        <Input placeholder="User" style={{ width: 120 }} />
                    </Form.Item>
                    <Form.Item name="password">
                        <Input.Password placeholder="Password" style={{ width: 120 }} />
                    </Form.Item>
                    <Form.Item name="port">
                        <InputNumber min={1} max={65535} placeholder="22" style={{ width: 68 }} />
                    </Form.Item>
                    <Form.Item shouldUpdate>
                        <Button type="primary" htmlType="submit">
                            Save and connect
                        </Button>
                    </Form.Item>
                </Form>
                <TargetList tab={tab} />
            </Card>
        </div>
    );
}
