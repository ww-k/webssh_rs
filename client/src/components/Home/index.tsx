import { Tabs } from "antd";
import { useCallback, useMemo } from "react";

import "./index.css";

import useAppStore from "@/store";

import Filesview from "../Filesview";
import TargetSelector from "../Target/Selector";
import Terminal from "../Terminal";
export default function Home() {
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

    const onEdit = useCallback(
        (
            targetKey: React.MouseEvent | React.KeyboardEvent | string,
            action: "add" | "remove",
        ) => {
            if (action === "add") {
                addTab();
            } else {
                removeTab(targetKey as string);
            }
        },
        [addTab, removeTab],
    );
    return (
        <Tabs
            activeKey={activeTabKey}
            className="WebSSH-Home-Tabs"
            items={tabsItems}
            onChange={(key) => {
                setActiveTabKey(key);
                document.body.click();
            }}
            onEdit={onEdit}
            type="editable-card"
        />
    );
}
