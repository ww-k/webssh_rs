import axios from "axios";
import { nanoid } from "nanoid";
import { create } from "zustand";

import i18n from "@/i18n";

import type { TabPaneProps } from "antd";
import type { IFileListCopyEvent } from "./components/Filelist/types";

export type ITabState = Record<string, unknown>;

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface ITab<T = ITabState>
    extends Omit<TabPaneProps, "tab" | "children" | "closeIcon" | "icon"> {
    key: string;
    label: string;
    path: string;
    state?: T;
}

type AppStore = {
    theme: ResolvedTheme;
    themeMode: ThemeMode;
    setTheme: (theme: ThemeMode) => void;

    sidebarCollapsed: boolean;
    setSidebarCollapsed: (collapsed: boolean) => void;

    showTerminalCopyNotification: boolean;
    setShowTerminalCopyNotification: (show: boolean) => void;

    activeMenuKey: string;
    setMenuKey: (key: string) => void;

    activeTabKey: string;
    tabs: ITab[];
    setActiveTabKey: (key: string) => void;
    addTab: () => string;
    removeTab: (key: string) => void;
    removeTabs: (keys: string[]) => void;
    renameTab: (key: string, label: string) => void;
    duplicateTab: (key: string) => void;
    setTabPath: (key: string, path: string, label?: string) => void;
    setTabState: (key: string, state: ITabState) => void;
    openSftpAt: (targetId: number, cwd: string, terminalTabKey: string) => void;
    openTerminalAt: (
        targetId: number,
        cwd: string | undefined,
        filesviewTabKey: string,
    ) => void;
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

const THEME_MODE_STORAGE_KEY = "webssh.theme-mode";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "webssh.sidebar-collapsed";
const TERMINAL_COPY_NOTIFICATION_STORAGE_KEY =
    "webssh.terminal-copy-notification";

function getSystemTheme(): ResolvedTheme {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}

function getInitialThemeMode(): ThemeMode {
    const stored = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system"
        ? stored
        : "system";
}

function getInitialSidebarCollapsed() {
    return (
        window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) !== "false"
    );
}

function getInitialShowTerminalCopyNotification() {
    return (
        window.localStorage.getItem(TERMINAL_COPY_NOTIFICATION_STORAGE_KEY) !==
        "false"
    );
}

const useAppStore = create<AppStore>((set) => {
    const initialTabs = getInitialTabs();
    const initialThemeMode = getInitialThemeMode();
    return {
        theme:
            initialThemeMode === "system" ? getSystemTheme() : initialThemeMode,
        themeMode: initialThemeMode,
        setTheme: (themeMode: ThemeMode) => {
            window.localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode);
            set({
                themeMode,
                theme: themeMode === "system" ? getSystemTheme() : themeMode,
            });
        },

        sidebarCollapsed: getInitialSidebarCollapsed(),
        setSidebarCollapsed: (collapsed: boolean) => {
            window.localStorage.setItem(
                SIDEBAR_COLLAPSED_STORAGE_KEY,
                String(collapsed),
            );
            set({ sidebarCollapsed: collapsed });
        },

        showTerminalCopyNotification: getInitialShowTerminalCopyNotification(),
        setShowTerminalCopyNotification: (show: boolean) => {
            window.localStorage.setItem(
                TERMINAL_COPY_NOTIFICATION_STORAGE_KEY,
                String(show),
            );
            set({ showTerminalCopyNotification: show });
        },

        activeMenuKey: "home",
        setMenuKey: (key: string) => set({ activeMenuKey: key }),

        ...initialTabs,
        setActiveTabKey: (key: string) => set({ activeTabKey: key }),
        addTab: () => {
            let newTabKey = "";
            set((state) => {
                const newTab = {
                    key: nanoid(),
                    label: "New Tab",
                    path: "/",
                };
                newTabKey = newTab.key;
                const newTabs = [...state.tabs];
                newTabs.push(newTab);
                return { activeTabKey: newTab.key, tabs: newTabs };
            });
            return newTabKey;
        },
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
        removeTabs: (keys: string[]) =>
            set((state) => {
                const keysToRemove = new Set(keys);
                if (keysToRemove.size === 0) return state;

                const removedIndexes = state.tabs
                    .map((tab, index) =>
                        keysToRemove.has(tab.key) ? index : -1,
                    )
                    .filter((index) => index >= 0);
                const newTabs = state.tabs.filter(
                    (tab) => !keysToRemove.has(tab.key),
                );

                if (
                    newTabs.length === 0 ||
                    !keysToRemove.has(state.activeTabKey)
                ) {
                    return { tabs: newTabs };
                }

                const firstRemovedIndex = removedIndexes[0];
                const previousTab = state.tabs
                    .slice(0, firstRemovedIndex)
                    .reverse()
                    .find((tab) => !keysToRemove.has(tab.key));

                return {
                    tabs: newTabs,
                    activeTabKey: previousTab?.key ?? newTabs[0].key,
                };
            }),
        renameTab: (key: string, label: string) =>
            set((state) => ({
                tabs: state.tabs.map((tab) =>
                    tab.key === key ? { ...tab, label } : tab,
                ),
            })),
        duplicateTab: (key: string) =>
            set((state) => {
                const tab = state.tabs.find((item) => item.key === key);
                if (!tab) return state;

                const newTab = {
                    ...tab,
                    key: nanoid(),
                    state: tab.state ? { ...tab.state } : undefined,
                };
                const tabIndex = state.tabs.findIndex(
                    (item) => item.key === key,
                );
                const tabs = [...state.tabs];
                tabs.splice(tabIndex + 1, 0, newTab);
                return { activeTabKey: newTab.key, tabs };
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
        openSftpAt: (targetId: number, cwd: string, terminalTabKey: string) =>
            set((state) => {
                const normalizedCwd =
                    cwd.length > 1 ? cwd.replace(/\/+$/, "") : cwd;
                const fileUri = `sftp:${targetId}:${normalizedCwd}`;
                const existingTab = state.tabs.find((tab) => {
                    if (tab.path !== `/filesview/${targetId}`) return false;
                    const tabState = tab.state as { cwd?: unknown } | undefined;
                    return tabState?.cwd === fileUri;
                });

                if (existingTab) {
                    return { activeTabKey: existingTab.key };
                }

                const terminalTab = state.tabs.find(
                    (tab) => tab.key === terminalTabKey,
                );
                const label = terminalTab?.label
                    ? terminalTab.label.replace(/^ssh\s/i, "sftp ")
                    : `sftp ${targetId}`;
                const newTab = {
                    key: nanoid(),
                    label,
                    path: `/filesview/${targetId}`,
                    state: {
                        cwd: fileUri,
                        linkedTerminalKey: terminalTabKey,
                    },
                };

                return {
                    activeTabKey: newTab.key,
                    tabs: [...state.tabs, newTab],
                };
            }),
        openTerminalAt: (
            targetId: number,
            cwd: string | undefined,
            filesviewTabKey: string,
        ) =>
            set((state) => {
                const filesviewTab = state.tabs.find(
                    (tab) => tab.key === filesviewTabKey,
                );
                const sourceLabel = filesviewTab?.label || `SSH ${targetId}`;
                const targetLabel = sourceLabel.replace(/^(sftp|ssh)\s+/i, "");
                const newTab = {
                    key: nanoid(),
                    label: `ssh ${targetLabel}`,
                    path: `/terminal/${targetId}`,
                    state: cwd ? { initialCwd: cwd } : undefined,
                };

                return {
                    activeTabKey: newTab.key,
                    tabs: [...state.tabs, newTab],
                };
            }),
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
        void axios
            .put("/api/preferences", {
                active_tab_key: state.activeTabKey,
                tabs: state.tabs.map(
                    ({ key, label, path, state: tabState }) => ({
                        key,
                        label,
                        path,
                        ...(tabState ? { state: tabState } : {}),
                    }),
                ),
            })
            .catch(() => {
                // Keep the current tabs available when saving fails.
            });
    }, 150);
});

export default useAppStore;
