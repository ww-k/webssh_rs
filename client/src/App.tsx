import { useMemo } from "react";
import { Tabs } from "antd";

import "./App.css";

import useAppStore from "./store";
import Terminal from "./components/terminal";
import TargetSelector from "./components/target/selector";

export default function App() {
    const { activeTabKey, tabs, setActiveTabKey, addTab, removeTab } = useAppStore();
    const tabsItems = useMemo(
        () =>
            tabs.map((tab) => ({
                ...tab,
                children: (
                    tab.path.startsWith("/terminal/") ? <Terminal tab={tab} /> : <TargetSelector tab={tab} />
                ),
            })),
        [tabs]
    );

    const onEdit = (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: "add" | "remove") => {
        if (action === "add") {
            addTab();
        } else {
            removeTab(targetKey as string);
        }
    };

    return (
        <Tabs
            className="WebSSH-Root-Tabs"
            type="editable-card"
            onChange={setActiveTabKey}
            activeKey={activeTabKey}
            onEdit={onEdit}
            items={tabsItems}
        />
    );
}
