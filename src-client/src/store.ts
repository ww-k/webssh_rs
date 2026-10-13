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

    copyData?: IFileListCopyEvent;
    setCopyData: (data: IFileListCopyEvent) => void;
};

const TABS_STORAGE_KEY = "webssh_rs_tabs";

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

    if (typeof window === "undefined") return fallback;

    try {
        const stored = window.localStorage.getItem(TABS_STORAGE_KEY);
        if (!stored) return fallback;

        const parsed: unknown = JSON.parse(stored);
        if (!parsed || typeof parsed !== "object") return fallback;

        const saved = parsed as {
            activeTabKey?: unknown;
            tabs?: unknown;
        };
        if (!Array.isArray(saved.tabs)) return fallback;

        const tabs = saved.tabs.filter(
            (tab): tab is ITab & { cwd?: string } =>
                !!tab &&
                typeof tab === "object" &&
                typeof tab.key === "string" &&
                typeof tab.label === "string" &&
                typeof tab.path === "string" &&
                tab.path.startsWith("/") &&
                (tab.state === undefined ||
                    (typeof tab.state === "object" &&
                        tab.state !== null &&
                        (tab.state.cwd === undefined ||
                            typeof tab.state.cwd === "string"))) &&
                (tab.cwd === undefined || typeof tab.cwd === "string"),
        );
        if (!tabs.length) return fallback;

        const normalizedTabs = tabs.map(({ cwd, ...tab }) => ({
            ...tab,
            ...(cwd !== undefined
                ? { state: { ...tab.state, cwd } }
                : {}),
        }));
        const activeTabKey = tabs.some((tab) => tab.key === saved.activeTabKey)
            ? (saved.activeTabKey as string)
            : normalizedTabs[0].key;
        return { activeTabKey, tabs: normalizedTabs };
    } catch {
        return fallback;
    }
}

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

    if (typeof window === "undefined") return;

    try {
        window.localStorage.setItem(
            TABS_STORAGE_KEY,
            JSON.stringify({
                activeTabKey: state.activeTabKey,
                tabs: state.tabs.map(({ key, label, path, state: tabState }) => ({
                    key,
                    label,
                    path,
                    ...(tabState ? { state: tabState } : {}),
                })),
            }),
        );
    } catch {
        // Tab state remains usable when browser storage is unavailable.
    }
});

export default useAppStore;
