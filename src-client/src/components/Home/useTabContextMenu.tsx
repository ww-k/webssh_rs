import {
    CloseCircleOutlined,
    CloseOutlined,
    CopyOutlined,
    EditOutlined,
} from "@ant-design/icons";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import renderPrompt from "@/helpers/renderPrompt";

import popContextMenu from "../Contextmenu";

import type { ITab } from "@/store";
import type { IContextmenuDataItem } from "../Contextmenu/typings";

interface TabContextMenuOptions {
    activeTabKey: string;
    duplicateTab: (key: string) => void;
    removeTab: (key: string) => void;
    removeTabs: (keys: string[]) => void;
    renameTab: (key: string, label: string) => void;
    setActiveTabKey: (key: string) => void;
    tabs: ITab[];
}

export default function useTabContextMenu({
    activeTabKey,
    duplicateTab,
    removeTab,
    removeTabs,
    renameTab,
    setActiveTabKey,
    tabs,
}: TabContextMenuOptions) {
    const { t } = useTranslation();

    return useCallback(
        (evt: React.MouseEvent<HTMLElement>, tabKey: string) => {
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
                void renderPrompt({
                    title: t("app_tab_rename_prompt"),
                    defaultValue: tab.label,
                    okText: t("app_btn_ok"),
                    cancelText: t("app_btn_cancel"),
                }).then((value) => {
                    const label = value?.trim();
                    if (label) renameTab(tabKey, label);
                });
            };

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
                    iconRender: () => <CloseOutlined />,
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
                    click: () => duplicateTab(tabKey),
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
}
