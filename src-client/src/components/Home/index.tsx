import {
    CloseCircleOutlined,
    CloseOutlined,
    CodeOutlined,
    CopyOutlined,
    DesktopOutlined,
    EditOutlined,
    FolderOutlined,
    PlusOutlined,
    SearchOutlined,
} from "@ant-design/icons";
import { Input } from "antd";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import "./index.css";

import renderPrompt from "@/helpers/renderPrompt";
import useAppStore from "@/store";

import popContextMenu from "../Contextmenu";
import Filesview from "../Filesview";
import TargetSelector from "../Target/Selector";
import Terminal from "../Terminal";

import type { ITab } from "@/store";
import type { IContextmenuDataItem } from "../Contextmenu/typings";

const TabPane = memo(function TabPane({
    active,
    tab,
}: {
    active: boolean;
    tab: ITab;
}) {
    let children: JSX.Element;
    switch (true) {
        case tab.path.startsWith("/terminal/"):
            children = <Terminal active={active} tab={tab} />;
            break;
        case tab.path.startsWith("/filesview/"):
            children = <Filesview tab={tab} />;
            break;
        default:
            children = <TargetSelector active={active} tab={tab} />;
            break;
    }

    return (
        <div
            className={`WebSSH-Home-Pane${active ? " is-active" : ""}`}
            aria-hidden={!active}
        >
            {children}
        </div>
    );
});

function Home({ active }: { active: boolean }) {
    const { t } = useTranslation();
    const activeTabKey = useAppStore((state) => state.activeTabKey);
    const tabs = useAppStore((state) => state.tabs);
    const setActiveTabKey = useAppStore((state) => state.setActiveTabKey);
    const addTab = useAppStore((state) => state.addTab);
    const removeTab = useAppStore((state) => state.removeTab);
    const removeTabs = useAppStore((state) => state.removeTabs);
    const renameTab = useAppStore((state) => state.renameTab);
    const duplicateTab = useAppStore((state) => state.duplicateTab);
    const [searchValue, setSearchValue] = useState("");
    // Keep visited panes mounted so switching tabs preserves their state.
    const mountedTabKeys = useRef(new Set([activeTabKey]));

    mountedTabKeys.current.add(activeTabKey);
    const tabKeys = new Set(tabs.map((tab) => tab.key));
    for (const key of mountedTabKeys.current) {
        if (!tabKeys.has(key)) mountedTabKeys.current.delete(key);
    }

    const onTabContextMenu = useCallback(
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

    const getTabIcon = (tab: (typeof tabs)[number]) => {
        if (tab.path.startsWith("/terminal/")) {
            return <CodeOutlined aria-hidden="true" />;
        }
        if (tab.path.startsWith("/filesview/")) {
            return <FolderOutlined aria-hidden="true" />;
        }
        return <DesktopOutlined aria-hidden="true" />;
    };

    const filteredTabs = useMemo(() => {
        const search = searchValue.trim().toLocaleLowerCase();
        if (!search) return tabs;
        return tabs.filter((tab) =>
          tab.label.toLocaleLowerCase().includes(search),
        );
    }, [searchValue, tabs]);

    const activeTab = tabs.find((tab) => tab.key === activeTabKey);

    return (
        <div
            className="WebSSH-Home"
            style={{ display: active ? undefined : "none" }}
        >
            <aside className="WebSSH-Home-Sidebar" tabIndex={0}>
                <div className="WebSSH-Home-SidebarHeader">
                    <div className="WebSSH-Home-SidebarSearch">
                        <Input
                            allowClear
                            aria-label={t("transfer_filter_keyword")}
                            placeholder={t("transfer_filter_keyword")}
                            prefix={<SearchOutlined aria-hidden="true" />}
                            value={searchValue}
                            onChange={(event) =>
                                setSearchValue(event.target.value)
                            }
                        />
                    </div>
                    <button
                        type="button"
                        className="WebSSH-Home-AddButton"
                        aria-label={t("app_tab_new")}
                        title={t("app_tab_new")}
                        onClick={() => onEdit("", "add")}
                    >
                        <PlusOutlined aria-hidden="true" />
                    </button>
                </div>
                <div className="WebSSH-Home-TabList" role="tablist">
                    {filteredTabs.map((tab) => {
                        const isActive = tab.key === activeTabKey;
                        return (
                            <div
                                key={tab.key}
                                role="tab"
                                tabIndex={0}
                                aria-selected={isActive}
                                className={`WebSSH-Home-Tab${isActive ? " is-active" : ""}`}
                                onClick={() => {
                                    setActiveTabKey(tab.key);
                                    document.body.click();
                                }}
                                onKeyDown={(evt) => {
                                    if (
                                        evt.key === "Enter" ||
                                        evt.key === " "
                                    ) {
                                        evt.preventDefault();
                                        setActiveTabKey(tab.key);
                                        document.body.click();
                                    }
                                }}
                                onContextMenu={(evt) =>
                                    onTabContextMenu(evt, tab.key)
                                }
                            >
                                <span className="WebSSH-Home-TabIcon">
                                    {getTabIcon(tab)}
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
                                        removeTab(tab.key);
                                    }}
                                >
                                    <CloseOutlined aria-hidden="true" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            </aside>
            <section className="WebSSH-Home-Content">
                <header className="WebSSH-Home-ContentHeader">
                    {activeTab ? (
                        <>
                            <span className="WebSSH-Home-ContentIcon">
                                {getTabIcon(activeTab)}
                            </span>
                            <span className="WebSSH-Home-ContentTitle">
                                {activeTab.label}
                            </span>
                        </>
                    ) : (
                        <span className="WebSSH-Home-ContentTitle">
                            {t("app_tab_new")}
                        </span>
                    )}
                </header>
                <div className="WebSSH-Home-Panes">
                    {tabs
                        .filter((tab) => mountedTabKeys.current.has(tab.key))
                        .map((tab) => (
                            <TabPane
                                key={tab.key}
                                active={tab.key === activeTabKey}
                                tab={tab}
                            />
                        ))}
                    {tabs.length === 0 && (
                        <div className="WebSSH-Home-Empty">
                            <DesktopOutlined aria-hidden="true" />
                            <span>{t("app_tab_new")}</span>
                            <button
                                type="button"
                                onClick={() => onEdit("", "add")}
                            >
                                <PlusOutlined aria-hidden="true" />
                                {t("app_tab_new")}
                            </button>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}

export default memo(Home) as typeof Home;
