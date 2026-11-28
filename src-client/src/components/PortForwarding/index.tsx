import {
    DeleteOutlined,
    EditOutlined,
    LinkOutlined,
    PlusCircleTwoTone,
    ReloadOutlined,
} from "@ant-design/icons";
import { toast } from "@ui-sdk/react/toast";
import { Form, InputNumber } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import "./index.css";

import {
    getPortForwardList,
    getTargetList,
    postPortForwardCreate,
    postPortForwardRemove,
    postPortForwardToggle,
    postPortForwardUpdate,
} from "@/api";
import Button from "@/components/Button";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import { AppDialog } from "@/components/Dialog";
import Input from "@/components/Input";
import PageLayout from "@/components/PageLayout";
import Popconfirm from "@/components/Popconfirm";
import Select from "@/components/Select";
import Switch from "@/components/Switch";
import getTargetName from "@/components/Target/getTargetName";
import Tooltip from "@/components/Tooltip";

import type { IPortForward, ITarget } from "@/api";

type PortForwardFormValues = {
    name: string;
    target_id: number;
    local_host: string;
    local_port: number;
    remote_host: string;
    remote_port: number;
};

function getTargetEndpoint(target: ITarget) {
    return `${target.user}@${target.host}${
        target.port && target.port !== 22 ? `:${target.port}` : ""
    }`;
}

export default function PortForwarding() {
    const { t } = useTranslation();
    const [form] = Form.useForm<PortForwardFormValues>();
    const [forwards, setForwards] = useState<IPortForward[]>([]);
    const [targets, setTargets] = useState<ITarget[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [removingId, setRemovingId] = useState<string>();
    const [togglingId, setTogglingId] = useState<string>();
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<IPortForward>();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [forwardList, targetList] = await Promise.all([
                getPortForwardList(),
                getTargetList(),
            ]);
            setForwards(forwardList);
            setTargets(targetList);
        } catch {
            toast.error(t("port_forward_load_failed"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void load();
    }, [load]);

    const openCreate = useCallback(() => {
        setEditing(undefined);
        form.resetFields();
        form.setFieldsValue({
            local_host: "127.0.0.1",
            // local_port: 19090,
            // remote_port: 9090,
        });
        setModalOpen(true);
    }, [form]);

    const openEdit = useCallback(
        (item: IPortForward) => {
            setEditing(item);
            form.setFieldsValue({
                name: item.name,
                target_id: item.target_id,
                local_host: item.local_host,
                local_port: item.local_port,
                remote_host: item.remote_host,
                remote_port: item.remote_port,
            });
            setModalOpen(true);
        },
        [form],
    );

    const create = useCallback(
        async (values: PortForwardFormValues) => {
            setSaving(true);
            try {
                const updated = editing
                    ? await postPortForwardUpdate({ ...values, id: editing.id })
                    : await postPortForwardCreate(values);
                if (editing) {
                    setForwards((items) =>
                        items.map((item) =>
                            item.id === updated.id ? updated : item,
                        ),
                    );
                }
                toast.success(
                    t(
                        editing
                            ? "port_forward_update_success"
                            : "port_forward_create_success",
                    ),
                );
                setModalOpen(false);
                if (!editing) await load();
            } catch {
                toast.error(
                    t(
                        editing
                            ? "port_forward_update_failed"
                            : "port_forward_create_failed",
                    ),
                );
            } finally {
                setSaving(false);
            }
        },
        [editing, load, t],
    );

    const remove = useCallback(
        async (id: string) => {
            setRemovingId(id);
            try {
                await postPortForwardRemove(id);
                setForwards((items) => items.filter((item) => item.id !== id));
                toast.success(t("port_forward_remove_success"));
            } catch {
                toast.error(t("port_forward_remove_failed"));
            } finally {
                setRemovingId(undefined);
            }
        },
        [t],
    );

    const toggle = useCallback(
        async (item: IPortForward) => {
            setTogglingId(item.id);
            try {
                const updated = await postPortForwardToggle(
                    item.id,
                    !item.enabled,
                );
                setForwards((items) =>
                    items.map((current) =>
                        current.id === updated.id ? updated : current,
                    ),
                );
                toast.success(
                    t(
                        updated.enabled
                            ? "port_forward_enable_success"
                            : "port_forward_disable_success",
                    ),
                );
            } catch {
                toast.error(
                    t(
                        item.enabled
                            ? "port_forward_disable_failed"
                            : "port_forward_enable_failed",
                    ),
                );
            } finally {
                setTogglingId(undefined);
            }
        },
        [t],
    );

    const columns: DataTableColumn<IPortForward>[] = useMemo(
        () => [
            {
                id: "name",
                header: t("port_forward_column_name"),
                accessor: (item) => item.name,
            },
            {
                id: "local_target",
                header: t("port_forward_column_local_target"),
                accessor: (item) => `${item.local_host}:${item.local_port}`,
                width: 180,
                cell: (_, item) => (
                    <span className="WebSSH-PortForwarding-LocalTarget">
                        <span>{`${item.local_host}:${item.local_port}`}</span>
                        {item.enabled && (
                            <Tooltip title={t("port_forward_open_local")}>
                                <a
                                    aria-label={t("port_forward_open_local")}
                                    href={`http://${item.local_host}:${item.local_port}`}
                                    rel="noreferrer"
                                    target="_blank"
                                >
                                    <LinkOutlined />
                                </a>
                            </Tooltip>
                        )}
                    </span>
                ),
            },
            {
                id: "remote_target",
                header: t("port_forward_column_remote_target"),
                accessor: (item) => `${item.remote_host}:${item.remote_port}`,
            },
            {
                id: "target",
                header: t("port_forward_column_target"),
                accessor: (item) => item.target_id,
                cell: (value) => {
                    const target = targets.find(
                        (item) => item.id === Number(value),
                    );
                    return target ? getTargetEndpoint(target) : String(value);
                },
            },
            {
                id: "enabled",
                header: t("port_forward_column_enabled"),
                accessor: (item) => item.enabled,
                width: 90,
                align: "center",
                cell: (_, item) => (
                    <Switch
                        aria-label={t(
                            item.enabled
                                ? "port_forward_disable"
                                : "port_forward_enable",
                        )}
                        checked={item.enabled}
                        loading={togglingId === item.id}
                        onCheckedChange={() => void toggle(item)}
                    />
                ),
            },
            {
                id: "actions",
                header: t("app_common_action"),
                accessor: () => "",
                width: 80,
                sortable: false,
                cell: (_, item) => (
                    <div className="WebSSH-Stack">
                        <Tooltip title={t("app_btn_edit")}>
                            <Button
                                aria-label={t("app_btn_edit")}
                                icon={<EditOutlined />}
                                onClick={() => openEdit(item)}
                                size="middle"
                                type="text"
                            />
                        </Tooltip>
                        <Popconfirm
                            title={t("port_forward_remove_confirm")}
                            okText={t("app_btn_ok")}
                            cancelText={t("app_btn_cancel")}
                            onConfirm={() => void remove(item.id)}
                        >
                            <Tooltip title={t("app_btn_delete")}>
                                <Button
                                    aria-label={t("app_btn_delete")}
                                    danger
                                    icon={<DeleteOutlined />}
                                    loading={removingId === item.id}
                                    size="middle"
                                    type="text"
                                />
                            </Tooltip>
                        </Popconfirm>
                    </div>
                ),
            },
        ],
        [openEdit, remove, removingId, t, targets, toggle, togglingId],
    );

    return (
        <>
            <PageLayout
                className="WebSSH-PortForwarding"
                toolbar={
                    <div className="WebSSH-Stack">
                        <Tooltip title={t("port_forward_create")}>
                            <Button
                                icon={<PlusCircleTwoTone />}
                                onClick={openCreate}
                            />
                        </Tooltip>
                        <Tooltip title={t("app_btn_refresh")}>
                            <Button
                                aria-label={t("app_btn_refresh")}
                                icon={<ReloadOutlined />}
                                loading={loading}
                                onClick={() => void load()}
                            />
                        </Tooltip>
                    </div>
                }
            >
                <DataTable
                    className="WebSSH-PortForwarding-Table"
                    columns={columns}
                    data={forwards}
                    emptyContent={t("port_forward_empty")}
                    getRowId={(item) => item.id}
                    loading={loading}
                    rowHeight={33}
                    selectable={false}
                    virtual
                />
            </PageLayout>
            <AppDialog
                title={t(editing ? "port_forward_edit" : "port_forward_create")}
                open={modalOpen}
                onCancel={() => setModalOpen(false)}
                footer={
                    <>
                        <Button onClick={() => setModalOpen(false)}>
                            {t("app_btn_cancel")}
                        </Button>
                        <Button
                            loading={saving}
                            type="primary"
                            onClick={() => void form.submit()}
                        >
                            {t("app_btn_save")}
                        </Button>
                    </>
                }
            >
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={(values) => void create(values)}
                >
                    <Form.Item
                        label={t("port_forward_name")}
                        name="name"
                        rules={[
                            {
                                required: true,
                                whitespace: true,
                                message: t("port_forward_name_required"),
                            },
                        ]}
                    >
                        <Input
                            placeholder={t("port_forward_name_placeholder")}
                        />
                    </Form.Item>
                    <Form.Item
                        label={t("port_forward_jump_host")}
                        name="target_id"
                        rules={[
                            {
                                required: true,
                                message: t("port_forward_target_required"),
                            },
                        ]}
                    >
                        <Select
                            aria-label={t("port_forward_jump_host")}
                            showSearch={{
                                optionFilterProp: "label",
                            }}
                            placeholder={t(
                                "port_forward_jump_host_placeholder",
                            )}
                            options={targets.map((target) => ({
                                label: getTargetName(target),
                                value: target.id,
                            }))}
                        />
                    </Form.Item>
                    <div className="WebSSH-PortForwarding-Compact">
                        <Form.Item
                            className="WebSSH-PortForwarding-HostField"
                            label={t("port_forward_remote_host")}
                            name="remote_host"
                            rules={[
                                {
                                    required: true,
                                    message: t(
                                        "port_forward_remote_host_required",
                                    ),
                                },
                            ]}
                        >
                            <Input
                                placeholder={t(
                                    "port_forward_remote_host_placeholder",
                                )}
                            />
                        </Form.Item>
                        <Form.Item
                            className="WebSSH-PortForwarding-PortField"
                            label={t("port_forward_remote_port")}
                            name="remote_port"
                            rules={[
                                {
                                    required: true,
                                    type: "number",
                                    min: 1,
                                    max: 65535,
                                },
                            ]}
                        >
                            <InputNumber
                                controls={false}
                                style={{ width: "100%" }}
                            />
                        </Form.Item>
                    </div>
                    <div className="WebSSH-PortForwarding-Compact">
                        <Form.Item
                            className="WebSSH-PortForwarding-HostField"
                            label={t("port_forward_local_host")}
                            name="local_host"
                            rules={[
                                {
                                    required: true,
                                    message: t(
                                        "port_forward_local_host_required",
                                    ),
                                },
                            ]}
                        >
                            <Input />
                        </Form.Item>
                        <Form.Item
                            className="WebSSH-PortForwarding-PortField"
                            label={t("port_forward_local_port")}
                            name="local_port"
                            rules={[
                                {
                                    required: true,
                                    type: "number",
                                    min: 1,
                                    max: 65535,
                                },
                            ]}
                        >
                            <InputNumber
                                controls={false}
                                style={{ width: "100%" }}
                            />
                        </Form.Item>
                    </div>
                </Form>
            </AppDialog>
        </>
    );
}
