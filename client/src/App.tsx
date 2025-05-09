import { useEffect, useMemo } from "react";
import { ConfigProvider, Tabs } from "antd";

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
                children: tab.path.startsWith("/terminal/") ? <Terminal tab={tab} /> : <TargetSelector tab={tab} />,
            })),
        [tabs]
    );

    useEffect(() => {
        window.onkeydown = (evt) => {
            console.log(`${evt.ctrlKey ? "Ctrl + " : ""}${evt.altKey ? "Alt + " : ""}${evt.shiftKey ? "Shift + " : ""}${evt.metaKey ? "Meta + " : ""}${evt.key} ${evt.code}`);
        };
    }, []);

    const onEdit = (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: "add" | "remove") => {
        if (action === "add") {
            addTab();
        } else {
            removeTab(targetKey as string);
        }
    };

    return (
        <ConfigProvider theme={{ cssVar: true, hashed: false }}>
            <Tabs
                className="WebSSH-Root-Tabs"
                type="editable-card"
                onChange={setActiveTabKey}
                activeKey={activeTabKey}
                onEdit={onEdit}
                items={tabsItems}
            />
        </ConfigProvider>
    );
}
