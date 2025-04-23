import { Button, Card, Form, Input } from "antd";

import "./selector.css";

import TargetList from "./list";

import type { ITab } from "@/store";

export default function TargetSelector({ tab }: { tab: ITab }) {
    const [form] = Form.useForm();

    const onFinish = (values: any) => {
        console.log("Finish:", values);
    };

    return (
        <div className="targetSelector">
            <Card style={{ width: 800 }} title="Select target">
                <Form form={form} className="targetSelectorAddForm" layout="inline" onFinish={onFinish}>
                    <Form.Item
                        name="host"
                        style={{ width: 200 }}
                        rules={[{ required: true, message: "Please input your host!" }]}
                    >
                        <Input placeholder="Host" />
                    </Form.Item>
                    <Form.Item name="username" rules={[{ required: true, message: "Please input your username!" }]}>
                        <Input placeholder="Username" style={{ width: 120 }} />
                    </Form.Item>
                    <Form.Item name="password">
                        <Input type="password" placeholder="Password" style={{ width: 120 }} />
                    </Form.Item>
                    <Form.Item name="port">
                        <Input placeholder="22" style={{ width: 68 }} />
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
                <TargetList tab={tab} />
            </Card>
        </div>
    );
}
