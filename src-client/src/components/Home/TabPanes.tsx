import { memo } from "react";

import TabPane from "./TabPane";

import type { ITab } from "@/store";

interface TabPanesProps {
    activeTabKey: string;
    mountedTabKeys: ReadonlySet<string>;
    tabs: ITab[];
}

const TabPanes = memo(function TabPanes({
    activeTabKey,
    mountedTabKeys,
    tabs,
}: TabPanesProps) {
    return (
        <>
            {tabs
                .filter((tab) => mountedTabKeys.has(tab.key))
                .map((tab) => (
                    <TabPane
                        className={`WebSSH-Home-Pane${tab.key === activeTabKey ? " is-active" : ""}`}
                        key={tab.key}
                        active={tab.key === activeTabKey}
                        tab={tab}
                    />
                ))}
        </>
    );
});

export default TabPanes;
