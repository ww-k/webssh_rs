import { memo, useCallback } from "react";

import useAppStore from "@/store";

import Content from "./Content";
import Sidebar from "./Sidebar";
import useMountedTabKeys from "./useMountedTabKeys";
import useSidebarResize from "./useSidebarResize";
import useTabContextMenu from "./useTabContextMenu";

import "./index.css";

function Home({ active }: { active: boolean }) {
    const activeTabKey = useAppStore((state) => state.activeTabKey);
    const tabs = useAppStore((state) => state.tabs);
    const setActiveTabKey = useAppStore((state) => state.setActiveTabKey);
    const addTab = useAppStore((state) => state.addTab);
    const removeTab = useAppStore((state) => state.removeTab);
    const removeTabs = useAppStore((state) => state.removeTabs);
    const renameTab = useAppStore((state) => state.renameTab);
    const duplicateTab = useAppStore((state) => state.duplicateTab);

    const {
        isResizingSidebar,
        onSidebarResizeMove,
        onSidebarResizeMoved,
        setTabListCollapsed,
        sidebarStyle,
        tabListCollapsed,
    } = useSidebarResize();
    const mountedTabKeys = useMountedTabKeys(activeTabKey, tabs);
    const onTabContextMenu = useTabContextMenu({
        activeTabKey,
        duplicateTab,
        removeTab,
        removeTabs,
        renameTab,
        setActiveTabKey,
        tabs,
    });
    const onAddTab = useCallback(() => {
        addTab();
    }, [addTab]);

    return (
        <div
            className={`WebSSH-Home${isResizingSidebar ? " is-resizing" : ""}`}
            style={{ display: active ? undefined : "none" }}
        >
            <Sidebar
                activeTabKey={activeTabKey}
                onAddTab={onAddTab}
                onCloseTab={removeTab}
                onSelectTab={setActiveTabKey}
                onSidebarResizeMove={onSidebarResizeMove}
                onSidebarResizeMoved={onSidebarResizeMoved}
                onTabContextMenu={onTabContextMenu}
                setTabListCollapsed={setTabListCollapsed}
                sidebarStyle={sidebarStyle}
                tabListCollapsed={tabListCollapsed}
                tabs={tabs}
            />
            <Content
                activeTabKey={activeTabKey}
                onAddTab={onAddTab}
                mountedTabKeys={mountedTabKeys}
                tabs={tabs}
            />
        </div>
    );
}

export default memo(Home) as typeof Home;
