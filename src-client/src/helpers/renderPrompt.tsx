import { Checkbox, Input, Modal, Radio, Space } from "antd";
import { createRef } from "react";

import type { InputRef } from "antd";

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
    return new Promise((resolve) => {
        let value = options.defaultValue ?? "";
        let settled = false;
        let destroyModal = () => {};
        const inputRef = createRef<InputRef>();

        const finish = (result?: string) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };

        const handleEnter = () => {
            finish(value);
            destroyModal();
        };

        const input = options.password ? (
            <Input.Password
                ref={inputRef}
                autoFocus={true}
                onChange={(event) => {
                    value = event.target.value;
                }}
                onPressEnter={handleEnter}
            />
        ) : (
            <Input
                ref={inputRef}
                autoFocus={true}
                defaultValue={value}
                onChange={(event) => {
                    value = event.target.value;
                }}
                onPressEnter={handleEnter}
            />
        );

        const modal = Modal.confirm({
            title: options.title,
            autoFocusButton: null,
            afterOpenChange: (open) => {
                if (open) {
                    inputRef.current?.focus();
                }
            },
            content: input,
            okText: options.okText,
            cancelText: options.cancelText,
            onOk: () => finish(value),
            onCancel: () => finish(),
        });
        destroyModal = modal.destroy;
    });
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
    return new Promise((resolve) => {
        let url = "";
        let password = "";
        let settled = false;
        let destroyModal = () => {};
        const inputRef = createRef<InputRef>();

        const finish = (result?: { url: string; password: string }) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };

        const handleEnter = () => {
            finish({ url, password });
            destroyModal();
        };

        const modal = Modal.confirm({
            title: options.title,
            autoFocusButton: null,
            afterOpenChange: (open) => {
                if (open) inputRef.current?.focus();
            },
            content: (
                <Space direction="vertical" style={{ width: "100%" }}>
                    <Input
                        ref={inputRef}
                        autoFocus={true}
                        placeholder={options.urlPlaceholder}
                        onChange={(event) => {
                            url = event.target.value;
                        }}
                        onPressEnter={handleEnter}
                    />
                    <Input.Password
                        placeholder={options.passwordPlaceholder}
                        onChange={(event) => {
                            password = event.target.value;
                        }}
                        onPressEnter={handleEnter}
                    />
                </Space>
            ),
            okText: options.okText,
            cancelText: options.cancelText,
            onOk: () => finish({ url, password }),
            onCancel: () => finish(),
        });
        destroyModal = modal.destroy;
    });
}

export interface RenderImportOptions {
    import_settings: boolean;
    import_targets: boolean;
    import_favorites: boolean;
    target_conflict: "skip" | "overwrite";
}

export function renderImportOptionsPrompt(options: {
    title: string;
    settingsLabel: string;
    targetsLabel: string;
    favoritesLabel: string;
    conflictLabel: string;
    skipLabel: string;
    overwriteLabel: string;
    okText?: string;
    cancelText?: string;
}): Promise<RenderImportOptions | undefined> {
    return new Promise((resolve) => {
        let value: RenderImportOptions = {
            import_settings: true,
            import_targets: true,
            import_favorites: true,
            target_conflict: "overwrite",
        };
        let settled = false;
        let destroyModal = () => {};
        const finish = (result?: RenderImportOptions) => {
            if (settled) return;
            settled = true;
            resolve(result);
            destroyModal();
        };
        const modal = Modal.confirm({
            title: options.title,
            content: (
                <Space direction="vertical">
                    <Checkbox
                        defaultChecked
                        onChange={(event) => {
                            value = {
                                ...value,
                                import_settings: event.target.checked,
                            };
                        }}
                    >
                        {options.settingsLabel}
                    </Checkbox>
                    <Checkbox
                        defaultChecked
                        onChange={(event) => {
                            value = {
                                ...value,
                                import_targets: event.target.checked,
                            };
                        }}
                    >
                        {options.targetsLabel}
                    </Checkbox>
                    <Checkbox
                        defaultChecked
                        onChange={(event) => {
                            value = {
                                ...value,
                                import_favorites: event.target.checked,
                            };
                        }}
                    >
                        {options.favoritesLabel}
                    </Checkbox>
                    <span>{options.conflictLabel}</span>
                    <Radio.Group
                        defaultValue="overwrite"
                        onChange={(event) => {
                            value = {
                                ...value,
                                target_conflict: event.target.value,
                            };
                        }}
                    >
                        <Space direction="vertical">
                            <Radio value="skip">{options.skipLabel}</Radio>
                            <Radio value="overwrite">
                                {options.overwriteLabel}
                            </Radio>
                        </Space>
                    </Radio.Group>
                </Space>
            ),
            okText: options.okText,
            cancelText: options.cancelText,
            onOk: () => finish(value),
            onCancel: () => finish(),
        });
        destroyModal = modal.destroy;
    });
}
