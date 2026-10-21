import { Input, Modal } from "antd";
import { createRef } from "react";

import type { InputRef } from "antd";

export interface RenderPromptOptions {
    title: string;
    defaultValue?: string;
    okText?: string;
    cancelText?: string;
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

        const modal = Modal.confirm({
            title: options.title,
            autoFocusButton: null,
            afterOpenChange: (open) => {
                if (open) {
                    inputRef.current?.focus();
                }
            },
            content: (
                <Input
                    ref={inputRef}
                    autoFocus={true}
                    defaultValue={value}
                    onChange={(event) => {
                        value = event.target.value;
                    }}
                    onPressEnter={() => {
                        finish(value);
                        destroyModal();
                    }}
                />
            ),
            okText: options.okText,
            cancelText: options.cancelText,
            onOk: () => finish(value),
            onCancel: () => finish(),
        });
        destroyModal = modal.destroy;
    });
}
