import axios from "axios";
import { nanoid } from "nanoid";
import { create } from "zustand";

import i18n from "@/i18n";

import { terminalThemeDefaults } from "./components/Terminal/constants";

import type { TabPaneProps } from "antd";
import type { IFileListCopyEvent } from "./components/Filelist/types";
import type {
    TerminalRightClickAction,
    TerminalThemeColorKey,
    TerminalThemeColors,
} from "./components/Terminal/types";

export type ITabState = Record<string, unknown>;

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export type Language = "zh" | "en";

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

    terminalSelectionCopyEnabled: boolean;
    setTerminalSelectionCopyEnabled: (enabled: boolean) => void;
    terminalRightClickAction: TerminalRightClickAction;
    setTerminalRightClickAction: (action: TerminalRightClickAction) => void;
    terminalMiddleClickPasteEnabled: boolean;
    setTerminalMiddleClickPasteEnabled: (enabled: boolean) => void;
    terminalThemes: Record<ResolvedTheme, TerminalThemeColors>;
    setTerminalThemeColor: (
        theme: ResolvedTheme,
        key: TerminalThemeColorKey,
        value: string,
    ) => void;

    language: Language;
    setLanguage: (language: Language) => void;

    lastLocalDirectory?: string;
    setLastLocalDirectory: (path: string) => void;

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
    loadPreferences: () => Promise<void>;

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
const terminalClipboardSettingsStorageKey =
    "webssh:terminal-clipboard-settings";

function getStoredTerminalClipboardSettings(): {
    selectionCopyEnabled?: boolean;
    rightClickAction?: TerminalRightClickAction;
    middleClickPasteEnabled?: boolean;
} {
    try {
        const value = JSON.parse(
            window.localStorage.getItem(terminalClipboardSettingsStorageKey) ||
                "null",
        ) as unknown;
        if (!value || typeof value !== "object") return {};
        const settings = value as Record<string, unknown>;
        const rightClickAction: TerminalRightClickAction | undefined =
            settings.rightClickAction === "paste" ||
            settings.rightClickAction === "menu"
                ? settings.rightClickAction
                : typeof settings.rightClickPasteEnabled === "boolean"
                  ? settings.rightClickPasteEnabled
                      ? "paste"
                      : "menu"
                  : undefined;
        return {
            ...(typeof settings.selectionCopyEnabled === "boolean"
                ? { selectionCopyEnabled: settings.selectionCopyEnabled }
                : {}),
            ...(rightClickAction ? { rightClickAction } : {}),
            ...(typeof settings.middleClickPasteEnabled === "boolean"
                ? { middleClickPasteEnabled: settings.middleClickPasteEnabled }
                : {}),
        };
    } catch {
        return {};
    }
}

function storeTerminalClipboardSettings(settings: {
    selectionCopyEnabled?: boolean;
    rightClickAction?: TerminalRightClickAction;
    middleClickPasteEnabled?: boolean;
}) {
    try {
        window.localStorage.setItem(
            terminalClipboardSettingsStorageKey,
            JSON.stringify({
                ...getStoredTerminalClipboardSettings(),
                ...settings,
            }),
        );
    } catch {
        // Local storage is only a persistence fallback.
    }
}

function getSystemTheme(): ResolvedTheme {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}

function getInitialThemeMode(): ThemeMode {
    return "system";
}

function getInitialSidebarCollapsed() {
    return true;
}

function getInitialShowTerminalCopyNotification() {
    return true;
}

function getInitialTerminalSelectionCopyEnabled() {
    return getStoredTerminalClipboardSettings().selectionCopyEnabled ?? true;
}

function getInitialTerminalRightClickAction(): TerminalRightClickAction {
    return getStoredTerminalClipboardSettings().rightClickAction ?? "paste";
}

function getInitialTerminalMiddleClickPasteEnabled() {
    return getStoredTerminalClipboardSettings().middleClickPasteEnabled ?? true;
}

function parseTerminalThemes(
    value: unknown,
): Record<ResolvedTheme, TerminalThemeColors> | undefined {
    if (!value || typeof value !== "object") return undefined;
    const input = value as Record<string, unknown>;
    const parseTheme = (mode: ResolvedTheme): TerminalThemeColors => {
        const source = input[mode];
        const values =
            source && typeof source === "object"
                ? (source as Record<string, unknown>)
                : {};
        const defaults = terminalThemeDefaults[mode];
        return {
            background:
                typeof values.background === "string"
                    ? values.background
                    : defaults.background,
            foreground:
                typeof values.foreground === "string"
                    ? values.foreground
                    : defaults.foreground,
            cursor:
                typeof values.cursor === "string"
                    ? values.cursor
                    : defaults.cursor,
            selectionBackground:
                typeof values.selectionBackground === "string"
                    ? values.selectionBackground
                    : typeof values.selection_background === "string"
                      ? values.selection_background
                      : defaults.selectionBackground,
            scrollbarThumb:
                typeof values.scrollbarThumb === "string"
                    ? values.scrollbarThumb
                    : typeof values.scrollbar_thumb === "string"
                      ? values.scrollbar_thumb
                      : defaults.scrollbarThumb,
        };
    };
    return { light: parseTheme("light"), dark: parseTheme("dark") };
}

function serializeTerminalThemes(
    themes: Record<ResolvedTheme, TerminalThemeColors>,
) {
    return {
        dark: {
            background: themes.dark.background,
            foreground: themes.dark.foreground,
            cursor: themes.dark.cursor,
            selection_background: themes.dark.selectionBackground,
            scrollbar_thumb: themes.dark.scrollbarThumb,
        },
        light: {
            background: themes.light.background,
            foreground: themes.light.foreground,
            cursor: themes.light.cursor,
            selection_background: themes.light.selectionBackground,
            scrollbar_thumb: themes.light.scrollbarThumb,
        },
    };
}

const useAppStore = create<AppStore>((set) => {
    const initialTabs = getInitialTabs();
    const initialThemeMode = getInitialThemeMode();
    return {
        theme:
            initialThemeMode === "system" ? getSystemTheme() : initialThemeMode,
        themeMode: initialThemeMode,
        setTheme: (themeMode: ThemeMode) => {
            set({
                themeMode,
                theme: themeMode === "system" ? getSystemTheme() : themeMode,
            });
        },

        sidebarCollapsed: getInitialSidebarCollapsed(),
        setSidebarCollapsed: (collapsed: boolean) => {
            set({ sidebarCollapsed: collapsed });
        },

        showTerminalCopyNotification: getInitialShowTerminalCopyNotification(),
        setShowTerminalCopyNotification: (show: boolean) => {
            set({ showTerminalCopyNotification: show });
        },

        terminalSelectionCopyEnabled: getInitialTerminalSelectionCopyEnabled(),
        setTerminalSelectionCopyEnabled: (enabled: boolean) => {
            storeTerminalClipboardSettings({ selectionCopyEnabled: enabled });
            set({ terminalSelectionCopyEnabled: enabled });
        },
        terminalRightClickAction: getInitialTerminalRightClickAction(),
        setTerminalRightClickAction: (action: TerminalRightClickAction) => {
            storeTerminalClipboardSettings({ rightClickAction: action });
            set({ terminalRightClickAction: action });
        },
        terminalMiddleClickPasteEnabled:
            getInitialTerminalMiddleClickPasteEnabled(),
        setTerminalMiddleClickPasteEnabled: (enabled: boolean) => {
            storeTerminalClipboardSettings({
                middleClickPasteEnabled: enabled,
            });
            set({ terminalMiddleClickPasteEnabled: enabled });
        },
        terminalThemes: {
            dark: { ...terminalThemeDefaults.dark },
            light: { ...terminalThemeDefaults.light },
        },
        setTerminalThemeColor: (theme, key, value) => {
            set((state) => ({
                terminalThemes: {
                    ...state.terminalThemes,
                    [theme]: { ...state.terminalThemes[theme], [key]: value },
                },
            }));
        },

        language: "zh",
        setLanguage: (language: Language) => {
            void i18n.changeLanguage(language);
            set({ language });
        },

        lastLocalDirectory: undefined,
        setLastLocalDirectory: (path: string) => {
            if (path) set({ lastLocalDirectory: path });
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
        loadPreferences: async () => {
            try {
                const response = await axios.get<{
                    active_tab_key: string;
                    tabs: ITab[];
                    settings?: {
                        theme_mode?: string;
                        sidebar_collapsed?: boolean;
                        show_terminal_copy_notification?: boolean;
                        terminal_selection_copy_enabled?: boolean;
                        terminal_right_click_paste_enabled?: boolean;
                        terminal_middle_click_paste_enabled?: boolean;
                        terminal_themes?: unknown;
                        language?: string;
                        last_local_directory?: string | null;
                    };
                } | null>("/api/preferences");
                const saved = response.data;
                const settings = saved?.settings;
                const storedTerminalSettings =
                    getStoredTerminalClipboardSettings();
                const themeMode = settings?.theme_mode;
                const language = settings?.language;
                const terminalThemes = parseTerminalThemes(
                    settings?.terminal_themes,
                );
                set({
                    ...(themeMode === "light" ||
                    themeMode === "dark" ||
                    themeMode === "system"
                        ? {
                              themeMode,
                              theme:
                                  themeMode === "system"
                                      ? getSystemTheme()
                                      : themeMode,
                          }
                        : {}),
                    ...(typeof settings?.sidebar_collapsed === "boolean"
                        ? { sidebarCollapsed: settings.sidebar_collapsed }
                        : {}),
                    ...(typeof settings?.show_terminal_copy_notification ===
                    "boolean"
                        ? {
                              showTerminalCopyNotification:
                                  settings.show_terminal_copy_notification,
                          }
                        : {}),
                    ...(typeof settings?.terminal_selection_copy_enabled ===
                    "boolean"
                        ? {
                              terminalSelectionCopyEnabled:
                                  storedTerminalSettings.selectionCopyEnabled ??
                                  settings.terminal_selection_copy_enabled,
                          }
                        : {}),
                    ...(typeof settings?.terminal_right_click_paste_enabled ===
                    "boolean"
                        ? {
                              terminalRightClickAction:
                                  storedTerminalSettings.rightClickAction ??
                                  (settings.terminal_right_click_paste_enabled
                                      ? "paste"
                                      : "menu"),
                          }
                        : {}),
                    ...(typeof settings?.terminal_middle_click_paste_enabled ===
                    "boolean"
                        ? {
                              terminalMiddleClickPasteEnabled:
                                  storedTerminalSettings.middleClickPasteEnabled ??
                                  settings.terminal_middle_click_paste_enabled,
                          }
                        : {}),
                    ...(terminalThemes ? { terminalThemes } : {}),
                    ...(language === "zh" || language === "en"
                        ? { language }
                        : {}),
                    ...(typeof settings?.last_local_directory === "string"
                        ? {
                              lastLocalDirectory: settings.last_local_directory,
                          }
                        : {}),
                });
                if (language === "zh" || language === "en") {
                    await i18n.changeLanguage(language);
                }
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
        state.activeTabKey === previousState.activeTabKey &&
        state.themeMode === previousState.themeMode &&
        state.sidebarCollapsed === previousState.sidebarCollapsed &&
        state.showTerminalCopyNotification ===
            previousState.showTerminalCopyNotification &&
        state.terminalSelectionCopyEnabled ===
            previousState.terminalSelectionCopyEnabled &&
        state.terminalRightClickAction ===
            previousState.terminalRightClickAction &&
        state.terminalMiddleClickPasteEnabled ===
            previousState.terminalMiddleClickPasteEnabled &&
        state.terminalThemes === previousState.terminalThemes &&
        state.language === previousState.language &&
        state.lastLocalDirectory === previousState.lastLocalDirectory
    ) {
        return;
    }

    if (!tabsHydrated) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        const current = useAppStore.getState();
        void axios
            .put("/api/preferences", {
                active_tab_key: current.activeTabKey,
                tabs: current.tabs.map(
                    ({ key, label, path, state: tabState }) => ({
                        key,
                        label,
                        path,
                        ...(tabState ? { state: tabState } : {}),
                    }),
                ),
                settings: {
                    theme_mode: current.themeMode,
                    sidebar_collapsed: current.sidebarCollapsed,
                    show_terminal_copy_notification:
                        current.showTerminalCopyNotification,
                    terminal_selection_copy_enabled:
                        current.terminalSelectionCopyEnabled,
                    terminal_right_click_paste_enabled:
                        current.terminalRightClickAction === "paste",
                    terminal_middle_click_paste_enabled:
                        current.terminalMiddleClickPasteEnabled,
                    terminal_themes: serializeTerminalThemes(
                        current.terminalThemes,
                    ),
                    language: current.language,
                    last_local_directory: current.lastLocalDirectory ?? null,
                },
            })
            .catch(() => {
                // Keep the current tabs available when saving fails.
            });
    }, 150);
});

export default useAppStore;
