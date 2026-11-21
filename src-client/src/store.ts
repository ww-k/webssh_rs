import axios from "axios";
import { nanoid } from "nanoid";
import { create } from "zustand";

import i18n from "@/i18n";

import { terminalThemeDefaults } from "./components/Terminal/constants";

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
export type TargetDoubleClickAction = "ssh" | "sftp";

export interface ITab {
    key: string;
    label: string;
    direction: "horizontal" | "vertical";
    ratio: number;
    path?: string;
    state?: ITabState;
    activeChildKey?: string;
    child1?: ITab;
    child2?: ITab;
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
    targetDoubleClickAction: TargetDoubleClickAction;
    setTargetDoubleClickAction: (action: TargetDoubleClickAction) => void;
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
    setActiveChildKey: (key: string) => void;
    addTab: () => string;
    splitView: (direction?: "horizontal" | "vertical") => void;
    removeTab: (key: string) => void;
    removeTabs: (keys: string[]) => void;
    renameTab: (key: string, label: string) => void;
    duplicateTab: (key: string) => void;
    setTabPath: (key: string, path: string, label?: string) => void;
    setTabState: (key: string, state: ITabState) => void;
    setSplitRatio: (key: string, ratio: number) => void;
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
    const firstTab = createView();
    const tabs: ITab[] = [
        {
            ...firstTab,
            activeChildKey: firstTab.key,
        },
    ];
    const fallback = {
        activeTabKey: firstTab.key,
        tabs,
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

function getInitialTargetDoubleClickAction(): TargetDoubleClickAction {
    return "ssh";
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

function createView(label = i18n.t("app_tab_new"), path = "/"): ITab {
    return {
        key: nanoid(),
        direction: "horizontal",
        ratio: 100,
        label,
        path,
    };
}

function getChildren(node: ITab): ITab[] {
    return [node.child1, node.child2].filter((child): child is ITab =>
        Boolean(child),
    );
}

function setChildren(node: ITab, children: ITab[]): ITab {
    const next = { ...node };
    if (children[0]) next.child1 = children[0];
    else delete next.child1;
    if (children[1]) next.child2 = children[1];
    else delete next.child2;
    return next;
}

function findNode(node: ITab, key: string): ITab | undefined {
    if (node.key === key) return node;
    for (const child of getChildren(node)) {
        const found = findNode(child, key);
        if (found) return found;
    }
    return undefined;
}

function mapNode(node: ITab, key: string, mapper: (node: ITab) => ITab): ITab {
    const children = getChildren(node);
    const mapped = children.length
        ? setChildren(
              node,
              children.map((child) => mapNode(child, key, mapper)),
          )
        : node;
    return mapped.key === key ? mapper(mapped) : mapped;
}

function findRootTab(tabs: ITab[], childKey: string) {
    return tabs.find((tab) => Boolean(findNode(tab, childKey)));
}

function findNodeByPath(
    node: ITab,
    path: string,
    cwd: string,
): ITab | undefined {
    if (
        getChildren(node).length === 0 &&
        node.path === path &&
        (node.state as { cwd?: unknown } | undefined)?.cwd === cwd
    ) {
        return node;
    }
    return getChildren(node).find((child) => findNodeByPath(child, path, cwd));
}

function firstLeaf(node: ITab): ITab {
    const children = getChildren(node);
    return children.length === 0 ? node : firstLeaf(children[0]);
}

function getRootChildKey(root: ITab) {
    return (
        findNode(root, root.activeChildKey ?? root.key)?.key ??
        firstLeaf(root).key
    );
}

function updateRoot(tabs: ITab[], key: string, update: (root: ITab) => ITab) {
    return tabs.map((root) => (root.key === key ? update(root) : root));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object";
}

function normalizeTabNode(value: unknown): ITab | undefined {
    if (!isRecord(value) || typeof value.key !== "string") return undefined;
    const child1 = normalizeTabNode(value.child1);
    const child2 = normalizeTabNode(value.child2);
    const children = [child1, child2].filter((child): child is ITab =>
        Boolean(child),
    );
    const isLeaf = children.length === 0;
    const label =
        typeof value.label === "string" ? value.label : i18n.t("app_tab_new");
    const path = typeof value.path === "string" ? value.path : undefined;
    const state = isRecord(value.state)
        ? (value.state as ITabState)
        : undefined;
    const direction =
        value.direction === "vertical" ? "vertical" : "horizontal";
    const ratio =
        typeof value.ratio === "number" && Number.isFinite(value.ratio)
            ? value.ratio
            : isLeaf
              ? 100
              : 50;
    return {
        key: value.key,
        label,
        direction,
        ratio: isLeaf
            ? 100
            : Math.max(15, Math.min(85, ratio <= 1 ? ratio * 100 : ratio)),
        ...(path !== undefined ? { path } : {}),
        ...(state ? { state } : {}),
        ...(children[0] ? { child1: children[0] } : {}),
        ...(children[1] ? { child2: children[1] } : {}),
    };
}

function normalizeSavedTab(value: unknown): ITab | undefined {
    if (!isRecord(value)) return undefined;
    const root = normalizeTabNode(value);
    if (!root) return undefined;
    const requestedActive = value.activeChildKey;
    root.activeChildKey =
        typeof requestedActive === "string" && findNode(root, requestedActive)
            ? requestedActive
            : firstLeaf(root).key;
    return root;
}

function serializeTab(node: ITab): Record<string, unknown> {
    const serialized: Record<string, unknown> = {
        key: node.key,
        label: node.label,
        direction: node.direction,
        ratio: getChildren(node).length
            ? Math.max(15, Math.min(85, node.ratio))
            : 100,
        ...(node.path !== undefined ? { path: node.path } : {}),
        ...(node.state !== undefined ? { state: node.state } : {}),
        ...(node.activeChildKey ? { activeChildKey: node.activeChildKey } : {}),
    };
    if (node.child1) serialized.child1 = serializeTab(node.child1);
    if (node.child2) serialized.child2 = serializeTab(node.child2);
    return serialized;
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
        targetDoubleClickAction: getInitialTargetDoubleClickAction(),
        setTargetDoubleClickAction: (action: TargetDoubleClickAction) => {
            set({ targetDoubleClickAction: action });
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
        setMenuKey: (key: string) =>
            set((state) =>
                state.activeMenuKey === key ? state : { activeMenuKey: key },
            ),

        ...initialTabs,
        setActiveTabKey: (key: string) =>
            set((state) => {
                return state.tabs.some((tab) => tab.key === key)
                    ? { activeTabKey: key }
                    : state;
            }),
        setActiveChildKey: (key: string) =>
            set((state) => {
                const root = findRootTab(state.tabs, key);
                if (!root) return state;
                const tabs = updateRoot(state.tabs, root.key, (tab) => ({
                    ...tab,
                    activeChildKey: key,
                }));
                return { activeTabKey: root.key, tabs };
            }),
        addTab: () => {
            let newTabKey = "";
            set((state) => {
                const newTab: ITab = {
                    ...createView(),
                };
                newTab.activeChildKey = newTab.key;
                newTabKey = newTab.key;
                const newTabs = [...state.tabs, newTab];
                return {
                    activeTabKey: newTab.key,
                    tabs: newTabs,
                };
            });
            return newTabKey;
        },
        splitView: (direction = "horizontal") =>
            set((state) => {
                const root = state.tabs.find(
                    (tab) => tab.key === state.activeTabKey,
                );
                if (!root) return state;
                const childKey = getRootChildKey(root);
                const current = findNode(root, childKey);
                if (!current || getChildren(current).length > 0) return state;
                const newView = createView();
                const currentLeaf = { ...current, key: nanoid() };
                delete currentLeaf.activeChildKey;
                const split: ITab = {
                    ...current,
                    direction,
                    ratio: 50,
                    child1: currentLeaf,
                    child2: newView,
                };
                delete split.path;
                delete split.state;
                delete split.activeChildKey;
                const layout = mapNode(root, current.key, () => split);
                const updatedTabs = updateRoot(state.tabs, root.key, (tab) => ({
                    ...tab,
                    ...layout,
                    activeChildKey: newView.key,
                }));
                return {
                    activeTabKey: root.key,
                    tabs: updatedTabs,
                };
            }),
        removeTab: (key: string) =>
            set((state) => {
                const index = state.tabs.findIndex((tab) => tab.key === key);
                if (index < 0) return state;
                const newTabs = state.tabs.filter((tab) => tab.key !== key);
                const nextActive =
                    state.activeTabKey === key
                        ? (newTabs[Math.max(0, index - 1)]?.key ??
                          newTabs[0]?.key ??
                          "")
                        : state.activeTabKey;
                return {
                    activeTabKey: nextActive,
                    tabs: newTabs,
                };
            }),
        removeTabs: (keys: string[]) =>
            set((state) => {
                const keysToRemove = new Set(keys);
                if (keysToRemove.size === 0) return state;
                const newTabs = state.tabs.filter(
                    (tab) => !keysToRemove.has(tab.key),
                );
                return {
                    tabs: newTabs,
                    activeTabKey: keysToRemove.has(state.activeTabKey)
                        ? (newTabs[0]?.key ?? "")
                        : state.activeTabKey,
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
                const cloneLayout = (node: ITab): ITab => ({
                    ...node,
                    key: nanoid(),
                    ...(node.child1
                        ? { child1: cloneLayout(node.child1) }
                        : {}),
                    ...(node.child2
                        ? { child2: cloneLayout(node.child2) }
                        : {}),
                    ...(node.state ? { state: { ...node.state } } : {}),
                });
                const duplicate = cloneLayout(tab);
                duplicate.activeChildKey = firstLeaf(duplicate).key;
                const tabIndex = state.tabs.findIndex(
                    (item) => item.key === key,
                );
                const tabs = [...state.tabs];
                tabs.splice(tabIndex + 1, 0, duplicate);
                return {
                    activeTabKey: duplicate.key,
                    tabs,
                };
            }),
        setTabPath: (key: string, path: string, label?: string) =>
            set((state) => {
                const root = findRootTab(state.tabs, key);
                if (!root) return state;
                const tabs = updateRoot(state.tabs, root.key, (tab) => ({
                    ...mapNode(tab, key, (node) => ({
                        ...node,
                        path,
                        ...(label ? { label } : {}),
                    })),
                    activeChildKey: key,
                }));
                return {
                    tabs,
                    activeTabKey: root.key,
                };
            }),
        setTabState: (key: string, tabState: ITabState) =>
            set((state) => {
                const root = findRootTab(state.tabs, key);
                if (!root) return state;
                const tabs = updateRoot(state.tabs, root.key, (tab) => ({
                    ...tab,
                    ...mapNode(tab, key, (node) => ({
                        ...node,
                        state: { ...node.state, ...tabState },
                    })),
                }));
                return { tabs };
            }),
        setSplitRatio: (key: string, ratio: number) =>
            set((state) => {
                const root = findRootTab(state.tabs, key);
                if (!root) return state;
                const tabs = updateRoot(state.tabs, root.key, (tab) => ({
                    ...tab,
                    ...mapNode(tab, key, (node) => ({
                        ...node,
                        ratio: Math.max(15, Math.min(85, ratio * 100)),
                    })),
                }));
                return { tabs };
            }),
        openSftpAt: (targetId: number, cwd: string, terminalTabKey: string) =>
            set((state) => {
                const normalizedCwd =
                    cwd.length > 1 ? cwd.replace(/\/+$/, "") : cwd;
                const fileUri = `sftp:${targetId}:${normalizedCwd}`;
                const existing = state.tabs
                    .map((root) => ({
                        root,
                        node: findNodeByPath(
                            root,
                            `/filesview/${targetId}`,
                            fileUri,
                        ),
                    }))
                    .find((item) => item.node);

                if (existing) {
                    const existingNode = existing.node;
                    if (!existingNode) return state;
                    const tabs = updateRoot(
                        state.tabs,
                        existing.root.key,
                        (root) => ({
                            ...root,
                            activeChildKey: existingNode.key,
                        }),
                    );
                    return {
                        activeTabKey: existing.root.key,
                        tabs,
                    };
                }

                const terminal = findRootTab(state.tabs, terminalTabKey);
                const terminalNode = terminal
                    ? findNode(terminal, terminalTabKey)
                    : undefined;
                const label = terminalNode?.label
                    ? terminalNode.label.replace(/^ssh\s/i, "sftp ")
                    : `sftp ${targetId}`;
                const view = createView(label, `/filesview/${targetId}`);
                view.state = {
                    cwd: fileUri,
                    linkedTerminalKey: terminalTabKey,
                };
                const newTab: ITab = {
                    ...view,
                    activeChildKey: view.key,
                };
                const tabs = [...state.tabs, newTab];
                return {
                    activeTabKey: newTab.key,
                    tabs,
                };
            }),
        openTerminalAt: (
            targetId: number,
            cwd: string | undefined,
            filesviewTabKey: string,
        ) =>
            set((state) => {
                const filesviewTab = findRootTab(state.tabs, filesviewTabKey);
                const filesviewNode = filesviewTab
                    ? findNode(filesviewTab, filesviewTabKey)
                    : undefined;
                if (!filesviewNode) return state;
                const view = createView(
                    `${filesviewNode.label}`,
                    `/terminal/${targetId}`,
                );
                if (cwd) view.state = { initialCwd: cwd };
                const newTab: ITab = {
                    ...view,
                    activeChildKey: view.key,
                };

                const tabs = [...state.tabs, newTab];
                return {
                    activeTabKey: newTab.key,
                    tabs,
                };
            }),
        loadPreferences: async () => {
            try {
                const response = await axios.get<{
                    active_tab_key: string;
                    tabs: unknown[];
                    settings?: {
                        theme_mode?: string;
                        sidebar_collapsed?: boolean;
                        show_terminal_copy_notification?: boolean;
                        terminal_selection_copy_enabled?: boolean;
                        terminal_right_click_paste_enabled?: boolean;
                        terminal_middle_click_paste_enabled?: boolean;
                        target_double_click_action?: string;
                        terminal_themes?: unknown;
                        language?: string;
                        last_local_directory?: string | null;
                    };
                } | null>("/api/app_state");
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
                    ...(settings?.target_double_click_action === "ssh" ||
                    settings?.target_double_click_action === "sftp"
                        ? {
                              targetDoubleClickAction:
                                  settings.target_double_click_action,
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
                    const tabs = saved.tabs.flatMap((tab) => {
                        const normalized = normalizeSavedTab(tab);
                        return normalized ? [normalized] : [];
                    });
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
        state.targetDoubleClickAction ===
            previousState.targetDoubleClickAction &&
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
            .put("/api/app_state", {
                active_tab_key: current.activeTabKey,
                tabs: current.tabs.map(serializeTab),
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
                    target_double_click_action: current.targetDoubleClickAction,
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
