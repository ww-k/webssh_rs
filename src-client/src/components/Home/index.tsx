import {
    CloseCircleOutlined,
    CloseOutlined,
    CodeOutlined,
    CopyOutlined,
    DesktopOutlined,
    EditOutlined,
    FolderOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    PlusOutlined,
    SearchOutlined,
} from "@ant-design/icons";
import { Input } from "antd";
import {
    memo,
    useCallback,
    useMemo,
    useRef,
    useState,
} from "react";
import { useTranslation } from "react-i18next";

import "./index.css";

import ResizeLine from "@/components/ResizeLine";
import renderPrompt from "@/helpers/renderPrompt";
import useAppStore from "@/store";

import popContextMenu from "../Contextmenu";
import Filesview from "../Filesview";
import TargetSelector from "../Target/Selector";
import Terminal from "../Terminal";

import type { ITab } from "@/store";
import type { IContextmenuDataItem } from "../Contextmenu/typings";

const DEFAULT_SIDEBAR_WIDTH = 180;
const MIN_SIDEBAR_WIDTH = 140;
const MAX_SIDEBAR_WIDTH = 240;
const COLLAPSED_SIDEBAR_WIDTH = 46;
const EXPAND_THRESHOLD_OFFSET = 10;

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
    const [tabListCollapsed, setTabListCollapsed] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
    const [isResizingSidebar, setIsResizingSidebar] = useState(false);
    const sidebarWidthRef = useRef(sidebarWidth);
    const tabListCollapsedRef = useRef(tabListCollapsed);
    const sidebarResizeOriginRef = useRef<number | null>(null);
    sidebarWidthRef.current = sidebarWidth;
    tabListCollapsedRef.current = tabListCollapsed;
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

    const onSidebarResizeMoved = useCallback(() => {
        sidebarResizeOriginRef.current = null;
        setIsResizingSidebar(false);
    }, []);

    const onSidebarResizeMove = useCallback(
        ({ moveX }: { moveX: number; moveY: number }) => {
            const isCollapsed = tabListCollapsedRef.current;
            const origin =
                sidebarResizeOriginRef.current ??
                (isCollapsed
                    ? COLLAPSED_SIDEBAR_WIDTH
                    : sidebarWidthRef.current);
            sidebarResizeOriginRef.current = origin;
            const requestedWidth = origin + moveX;
            if (
                isCollapsed &&
                requestedWidth >= MIN_SIDEBAR_WIDTH - EXPAND_THRESHOLD_OFFSET
            ) {
                sidebarResizeOriginRef.current = MIN_SIDEBAR_WIDTH - moveX;
                sidebarWidthRef.current = MIN_SIDEBAR_WIDTH;
                setSidebarWidth(MIN_SIDEBAR_WIDTH);
                tabListCollapsedRef.current = false;
                setTabListCollapsed(false);
                setIsResizingSidebar(true);
                return;
            }
            if (isCollapsed) {
                setIsResizingSidebar(true);
                return;
            }
            if (!isCollapsed && requestedWidth < COLLAPSED_SIDEBAR_WIDTH + EXPAND_THRESHOLD_OFFSET) {
                sidebarResizeOriginRef.current =
                    COLLAPSED_SIDEBAR_WIDTH - moveX;
                tabListCollapsedRef.current = true;
                setTabListCollapsed(true);
                setIsResizingSidebar(true);
                return;
            }
            setIsResizingSidebar(true);
            const nextWidth = Math.min(
                MAX_SIDEBAR_WIDTH,
                Math.max(MIN_SIDEBAR_WIDTH, requestedWidth),
            );
            setSidebarWidth(nextWidth);
        },
        [],
    );

    const sidebarStyle =
        tabListCollapsed || sidebarWidth === DEFAULT_SIDEBAR_WIDTH
            ? undefined
            : { flexBasis: `${sidebarWidth}px` };

    return (
        <div
            className={`WebSSH-Home${isResizingSidebar ? " is-resizing" : ""}`}
            style={{ display: active ? undefined : "none" }}
        >
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
                <div
                    id="WebSSH-Home-TabList"
                    className="WebSSH-Home-TabList"
                    role="tablist"
                >
                    {filteredTabs.map((tab) => {
                        const isActive = tab.key === activeTabKey;
                        return (
                            <div
                                key={tab.key}
                                role="tab"
                                tabIndex={0}
                                aria-selected={isActive}
                                title={tab.label}
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
