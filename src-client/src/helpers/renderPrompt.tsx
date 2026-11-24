import { Checkbox, Radio, Space } from "antd";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import Button from "@/components/Button";
import { AppDialog } from "@/components/Dialog";
import Input from "@/components/Input";

import type { ReactNode } from "react";

function mountDialog<T>(render: (finish: (value: T) => void) => ReactNode) {
    return new Promise<T>((resolve) => {
        const div = document.createElement("div");
        document.body.appendChild(div);
        const root = createRoot(div);
        let settled = false;
        const finish = (value: T) => {
            if (settled) return;
            settled = true;
            resolve(value);
            root.unmount();
            div.remove();
        };
        root.render(render(finish));
    });
}

export interface RenderPromptOptions {
    title: string;
    defaultValue?: string;
    okText?: string;
    cancelText?: string;
    password?: boolean;
}

export default function renderPrompt(
    options: RenderPromptOptions,
): Promise<string | undefined> {
    return mountDialog((finish) => (
        <PromptDialog options={options} onFinish={finish} />
    ));
}

function PromptDialog({
    options,
    onFinish,
}: {
    options: RenderPromptOptions;
    onFinish: (value?: string) => void;
}) {
    const [value, setValue] = useState(options.defaultValue ?? "");
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        inputRef.current?.focus();
    }, []);
    const inputProps = {
        ref: inputRef,
        autoFocus: true,
        value,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
            setValue(event.target.value),
        onPressEnter: () => onFinish(value),
    };
    return (
        <AppDialog
            open={true}
            title={options.title}
            initialFocus={() => inputRef.current}
            onCancel={() => onFinish()}
            footer={
                <>
                    <Button onClick={() => onFinish()}>
                        {options.cancelText ?? "Cancel"}
                    </Button>
                    <Button type="primary" onClick={() => onFinish(value)}>
                        {options.okText ?? "OK"}
                    </Button>
                </>
            }
        >
            {options.password ? (
                <Input.Password {...inputProps} />
            ) : (
                <Input {...inputProps} />
            )}
        </AppDialog>
    );
}

export interface RenderUrlPasswordPromptOptions {
    title: string;
    urlPlaceholder: string;
    passwordPlaceholder: string;
    okText?: string;
    cancelText?: string;
}

export function renderUrlPasswordPrompt(
    options: RenderUrlPasswordPromptOptions,
): Promise<{ url: string; password: string } | undefined> {
    return mountDialog((finish) => (
        <UrlPasswordPromptDialog options={options} onFinish={finish} />
    ));
}

function UrlPasswordPromptDialog({
    options,
    onFinish,
}: {
    options: RenderUrlPasswordPromptOptions;
    onFinish: (value?: { url: string; password: string }) => void;
}) {
    const [url, setUrl] = useState("");
    const [password, setPassword] = useState("");
    const urlRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        urlRef.current?.focus();
    }, []);
    const finish = () => onFinish({ url, password });
    return (
        <AppDialog
            open={true}
            title={options.title}
            initialFocus={() => urlRef.current}
            onCancel={() => onFinish()}
            footer={
                <>
                    <Button onClick={() => onFinish()}>
                        {options.cancelText ?? "Cancel"}
                    </Button>
                    <Button type="primary" onClick={finish}>
                        {options.okText ?? "OK"}
                    </Button>
                </>
            }
        >
            <Space direction="vertical" style={{ width: "100%" }}>
                <Input
                    ref={urlRef}
                    autoFocus={true}
                    placeholder={options.urlPlaceholder}
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    onPressEnter={finish}
                />
                <Input.Password
                    placeholder={options.passwordPlaceholder}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onPressEnter={finish}
                />
            </Space>
        </AppDialog>
    );
}

export interface RenderImportOptions {
    import_settings: boolean;
    import_targets: boolean;
    import_favorites: boolean;
    import_port_forwards: boolean;
    target_conflict: "skip" | "overwrite";
}

export function renderImportOptionsPrompt(options: {
    title: string;
    settingsLabel: string;
    targetsLabel: string;
    favoritesLabel: string;
    portForwardsLabel: string;
    conflictLabel: string;
    skipLabel: string;
    overwriteLabel: string;
    okText?: string;
    cancelText?: string;
}): Promise<RenderImportOptions | undefined> {
    return mountDialog((finish) => (
        <ImportOptionsDialog options={options} onFinish={finish} />
    ));
}

function ImportOptionsDialog({
    options,
    onFinish,
}: {
    options: {
        title: string;
        settingsLabel: string;
        targetsLabel: string;
        favoritesLabel: string;
        portForwardsLabel: string;
        conflictLabel: string;
        skipLabel: string;
        overwriteLabel: string;
        okText?: string;
        cancelText?: string;
    };
    onFinish: (value?: RenderImportOptions) => void;
}) {
    const [value, setValue] = useState<RenderImportOptions>({
        import_settings: true,
        import_targets: true,
        import_favorites: true,
        import_port_forwards: true,
        target_conflict: "overwrite",
    });
    return (
        <AppDialog
            open={true}
            title={options.title}
            onCancel={() => onFinish()}
            footer={
                <>
                    <Button onClick={() => onFinish()}>
                        {options.cancelText ?? "Cancel"}
                    </Button>
                    <Button type="primary" onClick={() => onFinish(value)}>
                        {options.okText ?? "OK"}
                    </Button>
                </>
            }
        >
            <Space direction="vertical">
                <Checkbox
                    checked={value.import_settings}
                    onChange={(event) =>
                        setValue((current) => ({
                            ...current,
                            import_settings: event.target.checked,
                        }))
                    }
                >
                    {options.settingsLabel}
                </Checkbox>
                <Checkbox
                    checked={value.import_port_forwards}
                    onChange={(event) =>
                        setValue((current) => ({
                            ...current,
                            import_port_forwards: event.target.checked,
                        }))
                    }
                >
                    {options.portForwardsLabel}
                </Checkbox>
                <Checkbox
                    checked={value.import_targets}
                    onChange={(event) =>
                        setValue((current) => ({
                            ...current,
                            import_targets: event.target.checked,
                        }))
                    }
                >
                    {options.targetsLabel}
                </Checkbox>
                <Checkbox
                    checked={value.import_favorites}
                    onChange={(event) =>
                        setValue((current) => ({
                            ...current,
                            import_favorites: event.target.checked,
                        }))
                    }
                >
                    {options.favoritesLabel}
                </Checkbox>
                <span>{options.conflictLabel}</span>
                <Radio.Group
                    value={value.target_conflict}
                    onChange={(event) =>
                        setValue((current) => ({
                            ...current,
                            target_conflict: event.target.value,
                        }))
                    }
                >
                    <Space direction="vertical">
                        <Radio value="skip">{options.skipLabel}</Radio>
                        <Radio value="overwrite">
                            {options.overwriteLabel}
                        </Radio>
                    </Space>
                </Radio.Group>
            </Space>
        </AppDialog>
    );
}
