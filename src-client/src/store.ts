import axios from "axios";
import { nanoid } from "nanoid";
import { create } from "zustand";

import i18n from "@/i18n";

import type { TabPaneProps } from "antd";
import type { IFileListCopyEvent } from "./components/Filelist/types";

export type ITabState = Record<string, unknown>;

export interface ITab<T = ITabState>
    extends Omit<TabPaneProps, "tab" | "children" | "closeIcon" | "icon"> {
    key: string;
    label: string;
    path: string;
    state?: T;
}

type AppStore = {
    theme: "light" | "dark";
    setTheme: (theme: "light" | "dark") => void;

    activeMenuKey: string;
    setMenuKey: (key: string) => void;

    activeTabKey: string;
    tabs: ITab[];
    setActiveTabKey: (key: string) => void;
    addTab: () => void;
    removeTab: (key: string) => void;
    setTabPath: (key: string, path: string, label?: string) => void;
    setTabState: (key: string, state: ITabState) => void;
    hydrateTabs: () => Promise<void>;

    copyData?: IFileListCopyEvent;
    setCopyData: (data: IFileListCopyEvent) => void;
};

function getInitialTabs() {
    const firstTabKey = nanoid();
    const fallback = {
        activeTabKey: firstTabKey,
        tabs: [
            {
                key: firstTabKey,
                label: i18n.t("app_tab_new"),
                path: "/",
            },
        ],
    };

    return fallback;
}

let tabsHydrated = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

const useAppStore = create<AppStore>((set) => {
    const initialTabs = getInitialTabs();
    return {
        theme: "light",
        setTheme: (theme: "light" | "dark") => set({ theme }),

        activeMenuKey: "home",
        setMenuKey: (key: string) => set({ activeMenuKey: key }),

        ...initialTabs,
        setActiveTabKey: (key: string) => set({ activeTabKey: key }),
        addTab: () =>
            set((state) => {
                const newTab = {
                    key: nanoid(),
                    label: "New Tab",
                    path: "/",
                };
                const newTabs = [...state.tabs];
                newTabs.push(newTab);
                return { activeTabKey: newTab.key, tabs: newTabs };
            }),
        removeTab: (key: string) =>
            set((state) => {
                const items = state.tabs;
                let newActiveKey = state.activeTabKey;
                let lastIndex = -1;
                items.forEach((item, i) => {
                    if (item.key === key) {
                        lastIndex = i - 1;
                    }
                });
                const newTabs = items.filter((item) => item.key !== key);
                if (newTabs.length && newActiveKey === key) {
                    if (lastIndex >= 0) {
                        newActiveKey = newTabs[lastIndex].key;
                    } else {
                        newActiveKey = newTabs[0].key;
                    }
                }
                return { activeTabKey: newActiveKey, tabs: newTabs };
            }),
        setTabPath: (key: string, path: string, label?: string) =>
            set((state) => {
                const newTabs = state.tabs.map((tab) => {
                    if (tab.key === key) {
                        return { ...tab, path, label: label || tab.label };
                    }
                    return tab;
                });
                return { tabs: newTabs };
            }),
        setTabState: (key: string, tabState: ITabState) =>
            set((state) => ({
                tabs: state.tabs.map((tab) =>
                    tab.key === key
                        ? { ...tab, state: { ...tab.state, ...tabState } }
                        : tab,
                ),
            })),
        hydrateTabs: async () => {
            try {
                const response = await axios.get<{
                    active_tab_key: string;
                    tabs: ITab[];
                } | null>("/api/preferences");
                const saved = response.data;
                if (saved?.tabs?.length) {
                    const tabs = saved.tabs.filter(
                        (tab) =>
                            typeof tab.key === "string" &&
                            typeof tab.label === "string" &&
                            typeof tab.path === "string" &&
                            tab.path.startsWith("/"),
                    );
                    if (tabs.length) {
                        set({
                            tabs,
                            activeTabKey: tabs.some(
                                (tab) => tab.key === saved.active_tab_key,
                            )
                                ? saved.active_tab_key
                                : tabs[0].key,
                        });
                    }
                }
            } catch {
                // Keep the default tab when preferences are unavailable.
            } finally {
                tabsHydrated = true;
            }
        },

        copyData: undefined,
        setCopyData: (data: IFileListCopyEvent) => set({ copyData: data }),
    };
});

useAppStore.subscribe((state, previousState) => {
    if (
        state.tabs === previousState.tabs &&
        state.activeTabKey === previousState.activeTabKey
    ) {
        return;
    }

    if (!tabsHydrated) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        void axios.put("/api/preferences", {
            active_tab_key: state.activeTabKey,
            tabs: state.tabs.map(({ key, label, path, state: tabState }) => ({
                key,
                label,
                path,
                ...(tabState ? { state: tabState } : {}),
            })),
        }).catch(() => {
            // Keep the current tabs available when saving fails.
        });
    }, 150);
});

export default useAppStore;
