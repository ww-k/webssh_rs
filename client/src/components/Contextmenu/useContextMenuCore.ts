import { useEffect, useMemo, useState } from "react";

import ContextMenuCore from "./core";

import type { IPositionInfo } from "./core";
import type { IContextmenuDataItem } from "./typings";

export default function useContextMenuCore({
    data,
    x,
    y,
    destroy,
}: {
    data: IContextmenuDataItem[];
    x: number;
    y: number;
    destroy: () => void;
}) {
    const [menusActiveInfo, setActiveInfoMap] = useState<
        Record<string, IPositionInfo | undefined>
    >({});
    const [menuItemsHoverInfo, setHoverInfoMap] = useState<
        Record<string, boolean>
    >({});
    const contextMenuCore = useMemo(() => {
        return new ContextMenuCore({
            data,
            x,
            y,
            onMenuActiveChange: (activeInfo) =>
                setActiveInfoMap({
                    ...activeInfo,
                }),
            onMenuItemHoverChange: (hoverInfo) =>
                setHoverInfoMap({
                    ...hoverInfo,
                }),
        });
    }, [data, x, y]);

    useEffect(() => {
        function destroy1(evt: Event) {
            if (
                // @ts-expect-error KeyboardEvent
                evt.key === "Escape" ||
                evt.type === "contextmenu" ||
                evt.type === "click"
            ) {
                if (typeof destroy === "function") {
                    destroy();
                }
                return;
            }
        }
        document.addEventListener("click", destroy1, false);
        document.addEventListener("contextmenu", destroy1, false);
        document.addEventListener("keydown", destroy1, true);

        contextMenuCore.adjustMainMenuPosition();

        return () => {
            document.removeEventListener("click", destroy1, false);
            document.removeEventListener("contextmenu", destroy1, false);
            document.removeEventListener("keydown", destroy1, true);
        };
    }, [contextMenuCore, destroy]);

    return {
        menuList: contextMenuCore.menuList,
        menusActiveInfo,
        menuItemsHoverInfo,
        handleMenuMouseEnter:
            contextMenuCore.handleMenuMouseEnter.bind(contextMenuCore),
        handleMenuMouseLeave:
            contextMenuCore.handleMenuMouseLeave.bind(contextMenuCore),
        handleMenuItemMouseEnter:
            contextMenuCore.handleMenuItemMouseEnter.bind(contextMenuCore),
        handleMenuItemMouseLeave:
            contextMenuCore.handleMenuItemMouseLeave.bind(contextMenuCore),
        setMenuElRef: contextMenuCore.setMenuElRef.bind(contextMenuCore),
    };
}
