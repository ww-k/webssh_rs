import { ConfigProvider, Tabs } from "antd";
import { useEffect, useMemo } from "react";

import "./App.css";

import useAppStore from "@/store";

import Filesview from "./components/Filesview";
import TargetSelector from "./components/Target/Selector";
import Terminal from "./components/Terminal";

export default function App() {
    const { activeTabKey, tabs, setActiveTabKey, addTab, removeTab } =
        useAppStore();
    const tabsItems = useMemo(
        () =>
            tabs.map((tab) => {
                let children: JSX.Element;
                switch (true) {
                    case tab.path.startsWith("/terminal/"):
                        children = (
                            <Terminal
                                active={activeTabKey === tab.key}
                                tab={tab}
                            />
                        );
                        break;
                    case tab.path.startsWith("/filesview/"):
                        children = (
                            <Filesview
                                active={activeTabKey === tab.key}
                                tab={tab}
                            />
                        );
                        break;
                    default:
                        children = <TargetSelector tab={tab} />;
                        break;
                }

                return {
                    ...tab,
                    children,
                };
            }),
        [tabs, activeTabKey],
    );

    useEffect(() => {
        window.onkeydown = (evt) => {
            console.log(
                `${evt.ctrlKey ? "Ctrl + " : ""}${evt.altKey ? "Alt + " : ""}${evt.shiftKey ? "Shift + " : ""}${
                    evt.metaKey ? "Meta + " : ""
                }${evt.key} ${evt.code}`,
            );
        };

        const preventDefault = (evt: DragEvent) => {
            evt.preventDefault();
            if (evt.dataTransfer) {
                evt.dataTransfer.dropEffect = "none";
            }
        };

        document.body.addEventListener("dragover", preventDefault, false);
        document.body.addEventListener("drop", preventDefault, false);

        return () => {
            document.body.removeEventListener("dragover", preventDefault);
            document.body.removeEventListener("drop", preventDefault);
        };
    }, []);

    const onEdit = (
        targetKey: React.MouseEvent | React.KeyboardEvent | string,
        action: "add" | "remove",
    ) => {
        if (action === "add") {
            addTab();
        } else {
            removeTab(targetKey as string);
        }
    };

    return (
        <ConfigProvider theme={{ cssVar: true, hashed: false }}>
            <Tabs
                activeKey={activeTabKey}
                className="WebSSH-Root-Tabs"
                items={tabsItems}
                onChange={(key) => {
                    setActiveTabKey(key);
                    document.body.click();
                }}
                onEdit={onEdit}
                type="editable-card"
            />
        </ConfigProvider>
    );
}
