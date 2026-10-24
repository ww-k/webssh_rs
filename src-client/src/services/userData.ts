import { getUserDataExport, postUserDataImport } from "@/api";
import { terminalThemeDefaults } from "@/components/Terminal/constants";

import type { TerminalThemeColors } from "@/components/Terminal/types";
import type { ResolvedTheme, ThemeMode } from "@/store";

type UserDataTerminalThemes = Record<ResolvedTheme, TerminalThemeColors>;

export interface UserDataExport {
    version: 1;
    exported_at: string;
    targets: Awaited<ReturnType<typeof getUserDataExport>>["targets"];
    favorite_directories: Awaited<
        ReturnType<typeof getUserDataExport>
    >["favorite_directories"];
    settings: {
        theme_mode: ThemeMode;
        sidebar_collapsed: boolean;
        show_terminal_copy_notification: boolean;
        terminal_selection_copy_enabled: boolean;
        terminal_right_click_paste_enabled: boolean;
        terminal_middle_click_paste_enabled: boolean;
        terminal_themes: UserDataTerminalThemes;
        language: string;
    };
}

export interface UserDataImportResult {
    addedTargets: number;
    skippedTargets: number;
    importedFavorites: number;
    settings: UserDataExport["settings"];
}

function readSettings(value: unknown): UserDataExport["settings"] {
    if (!value || typeof value !== "object") {
        return {
            theme_mode: "system",
            sidebar_collapsed: true,
            show_terminal_copy_notification: true,
            terminal_selection_copy_enabled: true,
            terminal_right_click_paste_enabled: true,
            terminal_middle_click_paste_enabled: true,
            terminal_themes: {
                dark: { ...terminalThemeDefaults.dark },
                light: { ...terminalThemeDefaults.light },
            },
            language: "zh",
        };
    }
    const settings = value as Partial<UserDataExport["settings"]>;
    if (
        settings.theme_mode !== "light" &&
        settings.theme_mode !== "dark" &&
        settings.theme_mode !== "system"
    ) {
        return {
            theme_mode: "system",
            sidebar_collapsed: true,
            show_terminal_copy_notification: true,
            terminal_selection_copy_enabled: true,
            terminal_right_click_paste_enabled: true,
            terminal_middle_click_paste_enabled: true,
            terminal_themes: {
                dark: { ...terminalThemeDefaults.dark },
                light: { ...terminalThemeDefaults.light },
            },
            language: "zh",
        };
    }
    const terminalThemes = readTerminalThemes(settings.terminal_themes);
    return {
        theme_mode: settings.theme_mode,
        sidebar_collapsed:
            typeof settings.sidebar_collapsed === "boolean"
                ? settings.sidebar_collapsed
                : true,
        show_terminal_copy_notification:
            typeof settings.show_terminal_copy_notification === "boolean"
                ? settings.show_terminal_copy_notification
                : true,
        terminal_selection_copy_enabled:
            typeof settings.terminal_selection_copy_enabled === "boolean"
                ? settings.terminal_selection_copy_enabled
                : true,
        terminal_right_click_paste_enabled:
            typeof settings.terminal_right_click_paste_enabled === "boolean"
                ? settings.terminal_right_click_paste_enabled
                : true,
        terminal_middle_click_paste_enabled:
            typeof settings.terminal_middle_click_paste_enabled === "boolean"
                ? settings.terminal_middle_click_paste_enabled
                : true,
        terminal_themes: terminalThemes,
        language:
            settings.language === "en" || settings.language === "zh"
                ? settings.language
                : "zh",
    };
}

function readTerminalThemes(value: unknown): UserDataTerminalThemes {
    if (!value || typeof value !== "object") {
        return {
            dark: { ...terminalThemeDefaults.dark },
            light: { ...terminalThemeDefaults.light },
        };
    }
    const input = value as Record<string, unknown>;
    const readTheme = (mode: ResolvedTheme): TerminalThemeColors => {
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
                    : defaults.selectionBackground,
            scrollbarThumb:
                typeof values.scrollbarThumb === "string"
                    ? values.scrollbarThumb
                    : defaults.scrollbarThumb,
        };
    };
    return { dark: readTheme("dark"), light: readTheme("light") };
}

export async function createUserDataExport(
    settings: UserDataExport["settings"],
) {
    const data = await getUserDataExport();
    return { ...data, settings } satisfies UserDataExport;
}

export async function importUserData(
    raw: unknown,
): Promise<UserDataImportResult> {
    if (!raw || typeof raw !== "object") {
        throw new Error("Invalid user data file");
    }
    const data = raw as Partial<UserDataExport>;
    if (data.version !== 1 || !Array.isArray(data.targets)) {
        throw new Error("Unsupported user data file");
    }
    const result = await postUserDataImport({
        version: 1,
        exported_at:
            typeof data.exported_at === "string"
                ? data.exported_at
                : new Date().toISOString(),
        targets: data.targets,
        favorite_directories: Array.isArray(data.favorite_directories)
            ? data.favorite_directories
            : [],
    });
    return {
        addedTargets: result.added_targets,
        skippedTargets: result.skipped_targets,
        importedFavorites: result.imported_favorites,
        settings: readSettings(data.settings),
    };
}
