import { Input, Modal } from "antd";

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

        const finish = (result?: string) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };

        const modal = Modal.confirm({
            title: options.title,
            content: (
                <Input
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
