import {
    CloseCircleOutlined,
    CloseOutlined,
    CopyOutlined,
    EditOutlined,
    VerticalRightOutlined,
} from "@ant-design/icons";
import { Tabs } from "antd";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import "./index.css";

import useAppStore from "@/store";

import popContextMenu from "../Contextmenu";
import Filesview from "../Filesview";
import TargetSelector from "../Target/Selector";
import Terminal from "../Terminal";

import type { IContextmenuDataItem } from "../Contextmenu/typings";

export default function Home({ active }: { active: boolean }) {
    const { t } = useTranslation();
    const {
        activeTabKey,
        tabs,
        setActiveTabKey,
        addTab,
        removeTab,
        removeTabs,
        renameTab,
        duplicateTab,
    } = useAppStore();

    const onTabContextMenu = useCallback(
        (evt: React.MouseEvent<HTMLSpanElement>, tabKey: string) => {
            evt.preventDefault();
            evt.stopPropagation();

            const tabIndex = tabs.findIndex((tab) => tab.key === tabKey);
            if (tabIndex < 0) return;

            const closeTab = () => removeTab(tabKey);
            const closeOtherTabs = () => {
                removeTabs(
                    tabs
                        .filter((tab) => tab.key !== tabKey)
                        .map((tab) => tab.key),
                );
                setActiveTabKey(tabKey);
            };
            const closeTabsToRight = () => {
                const keys = tabs.slice(tabIndex + 1).map((tab) => tab.key);
                removeTabs(keys);
                if (keys.includes(activeTabKey)) setActiveTabKey(tabKey);
            };
            const closeAllTabs = () => removeTabs(tabs.map((tab) => tab.key));
            const rename = () => {
                const tab = tabs[tabIndex];
                const label = window
                    .prompt(t("app_tab_rename_prompt"), tab.label)
                    ?.trim();
                if (label) renameTab(tabKey, label);
            };
            const duplicate = () => duplicateTab(tabKey);

            const menus: IContextmenuDataItem[] = [
                {
                    label: t("app_tab_close_current"),
                    click: closeTab,
                    iconRender: () => <CloseOutlined />,
                },
                {
                    label: t("app_tab_close_others"),
                    disabled: tabs.length <= 1,
                    click: closeOtherTabs,
                    iconRender: () => <CloseCircleOutlined />,
                },
                {
                    label: t("app_tab_close_right"),
                    disabled: tabIndex === tabs.length - 1,
                    click: closeTabsToRight,
                    iconRender: () => <VerticalRightOutlined />,
                },
                {
                    label: t("app_tab_close_all"),
                    click: closeAllTabs,
                    iconRender: () => <CloseCircleOutlined />,
                },
                { type: "divider" },
                {
                    label: t("app_tab_rename"),
                    click: rename,
                    iconRender: () => <EditOutlined />,
                },
                {
                    label: t("app_tab_duplicate"),
                    click: duplicate,
                    iconRender: () => <CopyOutlined />,
                },
            ];

            popContextMenu(menus, evt.clientX, evt.clientY);
        },
        [
            activeTabKey,
            duplicateTab,
            removeTab,
            removeTabs,
            renameTab,
            setActiveTabKey,
            t,
            tabs,
        ],
    );

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
                        children = <Filesview tab={tab} />;
                        break;
                    default:
                        children = <TargetSelector tab={tab} />;
                        break;
                }

                return {
                    ...tab,
                    label: (
                        <span
                            onContextMenu={(evt) =>
                                onTabContextMenu(evt, tab.key)
                            }
                        >
                            {tab.label}
                        </span>
                    ),
                    children,
                };
            }),
        [activeTabKey, onTabContextMenu, tabs],
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
            style={{ visibility: active ? "visible" : "hidden" }}
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
