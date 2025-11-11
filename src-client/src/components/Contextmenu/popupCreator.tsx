import { createRoot } from "react-dom/client";

import type { Root } from "react-dom/client";
import type { IContextmenuDataItem } from "./typings";

let contextMenuContainer: HTMLDivElement;
let contextMenuRoot: Root;

export function popupCreator(
    Contextmenu: React.ComponentType<{
        data: IContextmenuDataItem[];
        x: number;
        y: number;
        destroy: () => void;
        [key: string]: unknown;
    }>,
) {
    return function popup(
        data: IContextmenuDataItem[],
        x: number,
        y: number,
        otherProps?: { container?: HTMLElement; [key: string]: unknown },
    ) {
        let container: HTMLElement;
        if (otherProps?.container) {
            container = otherProps.container;
            const { top, left } = container.getBoundingClientRect();
            x = x - left;
            y = y - top;
        } else if (!contextMenuContainer) {
            contextMenuContainer = document.createElement("div");
            document.body.appendChild(contextMenuContainer);
            container = contextMenuContainer;
            contextMenuRoot = createRoot(container);
        } else {
            container = contextMenuContainer;
        }

        function destroy() {
            contextMenuRoot.render(null);
        }

        contextMenuRoot.render(
            <Contextmenu
                data={data}
                x={x}
                y={y}
                destroy={destroy}
                {...otherProps}
            />,
        );

        return {
            destroy,
        };
    };
}
