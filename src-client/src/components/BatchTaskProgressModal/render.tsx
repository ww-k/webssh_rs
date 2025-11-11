import { createRoot } from "react-dom/client";

import BatchTaskProgressModal from "./index";

import type { BatchTaskProgressModalProps } from "./index";

function actionButton(props: {
    actionFn?: (...args: any) => unknown | Promise<unknown>;
    closeModal: (...args: any) => any;
}) {
    const { actionFn, closeModal } = props;

    if (typeof actionFn === "function") {
        const ret = actionFn();
        if (!ret) {
            closeModal();
        } else if (ret instanceof Promise && typeof ret.then === "function") {
            ret.then(closeModal);
        }
    } else {
        closeModal();
    }
}

export default function renderBatchTaskProgressModal<T>(
    props: BatchTaskProgressModalProps<T>,
) {
    return new Promise((resolve, reject) => {
        const div = document.createElement("div");
        document.body.appendChild(div);
        const root = createRoot(div);

        function onOk() {
            actionButton({ actionFn: props.onOk, closeModal: destroy });
            resolve(true);
        }

        function onCancel() {
            actionButton({ actionFn: props.onCancel, closeModal: destroy });
            reject();
        }

        function destroy() {
            root.unmount();
            if (div.parentNode) {
                div.parentNode.removeChild(div);
            }
        }

        root.render(
            <BatchTaskProgressModal<T>
                {...props}
                open={true}
                onOk={onOk}
                onCancel={onCancel}
            />,
        );
    });
}
