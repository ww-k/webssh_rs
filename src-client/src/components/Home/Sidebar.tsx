import {
    CloseOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    PlusOutlined,
    SearchOutlined,
} from "@ant-design/icons";
import { Input } from "antd";
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import ResizeLine from "../ResizeLine";
import getTabIcon from "./tabIcon";

import type { CSSProperties, MouseEvent } from "react";
import type { ITab } from "@/store";

interface SidebarProps {
    activeTabKey: string;
    onAddTab: () => void;
    onCloseTab: (tabKey: string) => void;
    onSelectTab: (tabKey: string) => void;
    onTabContextMenu: (evt: MouseEvent<HTMLElement>, tabKey: string) => void;
    onSidebarResizeMove: (evt: { moveX: number; moveY: number }) => void;
    onSidebarResizeMoved: () => void;
    setTabListCollapsed: (
        collapsed: boolean | ((collapsed: boolean) => boolean),
    ) => void;
    sidebarStyle?: CSSProperties;
    tabListCollapsed: boolean;
    tabs: ITab[];
}

const Sidebar = memo(function Sidebar({
    activeTabKey,
    onAddTab,
    onCloseTab,
    onSelectTab,
    onSidebarResizeMove,
    onSidebarResizeMoved,
    onTabContextMenu,
    setTabListCollapsed,
    sidebarStyle,
    tabListCollapsed,
    tabs,
}: SidebarProps) {
    const { t } = useTranslation();
    const [searchValue, setSearchValue] = useState("");
    const filteredTabs = useMemo(() => {
        const search = searchValue.trim().toLocaleLowerCase();
        if (!search) return tabs;
        return tabs.filter((tab) =>
            tab.label.toLocaleLowerCase().includes(search),
        );
    }, [searchValue, tabs]);

    return (
        <aside
            className={`WebSSH-Home-Sidebar${
                tabListCollapsed ? " is-collapsed" : ""
            }`}
            style={sidebarStyle}
            tabIndex={0}
        >
            <div className="WebSSH-Home-SidebarHeader">
                <div className="WebSSH-Home-SidebarSearch">
                    <Input
                        allowClear
                        aria-label={t("transfer_filter_keyword")}
                        placeholder={t("transfer_filter_keyword")}
                        prefix={<SearchOutlined aria-hidden="true" />}
                        value={searchValue}
                        onChange={(event) => setSearchValue(event.target.value)}
                    />
                </div>
                <button
                    type="button"
                    className="WebSSH-Home-AddButton"
                    aria-label={t("app_tab_new")}
                    title={t("app_tab_new")}
                    onClick={onAddTab}
                >
                    <PlusOutlined aria-hidden="true" />
                </button>
            </div>
            <div
                id="WebSSH-Home-TabList"
                className="WebSSH-Home-TabList"
                role="tablist"
            >
                {filteredTabs.map((tab) => {
                    const isActive = tab.key === activeTabKey;
                    const selectTab = () => {
                        onSelectTab(tab.key);
                        document.body.click();
                    };
                    return (
                        <div
                            key={tab.key}
                            role="tab"
                            tabIndex={0}
                            aria-selected={isActive}
                            title={tab.label}
                            className={`WebSSH-Home-Tab${isActive ? " is-active" : ""}`}
                            onClick={selectTab}
                            onKeyDown={(evt) => {
                                if (evt.key === "Enter" || evt.key === " ") {
                                    evt.preventDefault();
                                    selectTab();
                                }
                            }}
                            onContextMenu={(evt) =>
                                onTabContextMenu(evt, tab.key)
                            }
                        >
                            <span className="WebSSH-Home-TabIcon">
                                {getTabIcon(tab.path)}
                            </span>
                            <span className="WebSSH-Home-TabInfo">
                                <span className="WebSSH-Home-TabName">
                                    {tab.label}
                                </span>
                            </span>
                            <button
                                type="button"
                                className="WebSSH-Home-TabClose"
                                aria-label={t("app_tab_close_current")}
                                title={t("app_tab_close_current")}
                                onClick={(evt) => {
                                    evt.stopPropagation();
                                    onCloseTab(tab.key);
                                }}
                            >
                                <CloseOutlined aria-hidden="true" />
                            </button>
                        </div>
                    );
                })}
            </div>
            <div className="WebSSH-Home-SidebarFooter">
                <button
                    type="button"
                    className="WebSSH-Home-SidebarToggle"
                    aria-expanded={!tabListCollapsed}
                    aria-controls="WebSSH-Home-TabList"
                    aria-label={t(
                        tabListCollapsed
                            ? "app_tab_expand"
                            : "app_tab_collapse",
                    )}
                    title={t(
                        tabListCollapsed
                            ? "app_tab_expand"
                            : "app_tab_collapse",
                    )}
                    onClick={() =>
                        setTabListCollapsed((collapsed) => !collapsed)
                    }
                >
                    {tabListCollapsed ? (
                        <MenuUnfoldOutlined aria-hidden="true" />
                    ) : (
                        <MenuFoldOutlined aria-hidden="true" />
                    )}
                </button>
            </div>
            <ResizeLine
                className="WebSSH-Home-SidebarResizeHandle"
                direction="v"
                onMove={onSidebarResizeMove}
                onMoved={onSidebarResizeMoved}
            />
        </aside>
    );
});

export default Sidebar;
