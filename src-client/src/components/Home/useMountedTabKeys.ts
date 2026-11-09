import { useRef } from "react";

import type { ITab } from "@/store";

export default function useMountedTabKeys(activeTabKey: string, tabs: ITab[]) {
    const mountedTabKeys = useRef(new Set([activeTabKey]));

    // Keep visited panes mounted so switching tabs preserves their state.
    mountedTabKeys.current.add(activeTabKey);
    const tabKeys = new Set(tabs.map((tab) => tab.key));
    for (const key of mountedTabKeys.current) {
        if (!tabKeys.has(key)) mountedTabKeys.current.delete(key);
    }

    return mountedTabKeys.current;
}
