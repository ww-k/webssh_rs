import { Input, Modal, Space } from "antd";
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
