import { nanoid } from "nanoid";
import { create } from "zustand";

import type { TabPaneProps } from "antd";

export interface ITab extends Omit<TabPaneProps, "tab" | "children" | "closeIcon" | "icon"> {
    key: string;
    label: string;
    path: string;
}

type AppStore = {
    activeTabKey: string;
    tabs: ITab[];
    setActiveTabKey: (key: string) => void;
    addTab: () => void;
    removeTab: (key: string) => void;
    setTabPath: (key: string, path: string, label?: string) => void;
};

const useAppStore = create<AppStore>((set) => {
    const firstTabKey = nanoid();
    return {
        activeTabKey: firstTabKey,
        tabs: [
            {
                key: firstTabKey,
                label: "New Tab",
                path: "/",
            },
        ],
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
    };
});

export default useAppStore;
