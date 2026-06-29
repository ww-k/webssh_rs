import { createRoot } from "react-dom/client";

import FsSelector from "./index";

export default function renderFsSelector(option: {
    mode: "file" | "directory";
    multiple?: boolean;
    title: string;
}) {
    return new Promise<string[]>((resolve, reject) => {
        const div = document.createElement("div");
        document.body.appendChild(div);
        const root = createRoot(div);

        function destroy() {
            root.unmount();
            if (div.parentNode) {
                div.parentNode.removeChild(div);
            }
        }

        root.render(
            <FsSelector
                open={true}
                mode={option.mode}
                multiple={option.multiple}
                title={option.title}
                onOk={(paths) => {
                    destroy();
                    resolve(paths);
                }}
                onCancel={() => {
                    destroy();
                    reject();
                }}
            />,
        );
    });
}
