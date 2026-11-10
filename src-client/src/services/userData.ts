import {
    postUserDataExport,
    postUserDataImport,
    postUserDataImportUrl,
} from "@/api";
import { terminalThemeDefaults } from "@/components/Terminal/constants";

import type { TerminalThemeColors } from "@/components/Terminal/types";
import type { ResolvedTheme, ThemeMode } from "@/store";

type UserDataTerminalThemes = Record<ResolvedTheme, TerminalThemeColors>;

export interface UserDataSettings {
    theme_mode: ThemeMode;
    sidebar_collapsed: boolean;
    show_terminal_copy_notification: boolean;
    terminal_selection_copy_enabled: boolean;
    terminal_right_click_paste_enabled: boolean;
    terminal_middle_click_paste_enabled: boolean;
    target_double_click_action: "ssh" | "sftp";
    terminal_themes: UserDataTerminalThemes;
    language: string;
}
export interface UserDataImportResult {
    addedTargets: number;
    updatedTargets: number;
    skippedTargets: number;
    importedFavorites: number;
    settings?: UserDataSettings;
}
function readSettings(value: unknown): UserDataSettings {
    if (!value || typeof value !== "object") {
        return {
            theme_mode: "system",
            sidebar_collapsed: true,
            show_terminal_copy_notification: true,
            terminal_selection_copy_enabled: true,
            terminal_right_click_paste_enabled: true,
            terminal_middle_click_paste_enabled: true,
            target_double_click_action: "ssh",
            terminal_themes: {
                dark: { ...terminalThemeDefaults.dark },
                light: { ...terminalThemeDefaults.light },
            },
            language: "zh",
        };
    }
    const settings = value as Partial<UserDataSettings>;
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
            target_double_click_action: "ssh",
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
        target_double_click_action:
            settings.target_double_click_action === "sftp" ? "sftp" : "ssh",
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
    settings: UserDataSettings,
    password?: string,
) {
    return postUserDataExport({
        ...(password ? { password } : {}),
        settings,
    });
}

export async function importUserData(
    raw: unknown,
    password?: string,
    options?: UserDataImportOptions,
): Promise<UserDataImportResult> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Invalid user data file");
    }
    const data = raw as Record<string, unknown>;
    if (data.version !== 1) {
        throw new Error("Unsupported user data file");
    }
    const encrypted =
        typeof data.algorithm === "string" &&
        typeof data.salt === "string" &&
        typeof data.nonce === "string" &&
        typeof data.ciphertext === "string";
    if (encrypted && !password) {
        throw new Error("Password is required");
    }
    const result = await postUserDataImport({
        ...(encrypted && password ? { password } : {}),
        data: raw,
        ...options,
    });
    return {
        addedTargets: result.added_targets,
        updatedTargets: result.updated_targets ?? 0,
        skippedTargets: result.skipped_targets,
        importedFavorites: result.imported_favorites,
        settings: result.settings ? readSettings(result.settings) : undefined,
    };
}

export async function importUserDataFromUrl(
    url: string,
    password?: string,
    options?: UserDataImportOptions,
): Promise<UserDataImportResult> {
    const result = await postUserDataImportUrl({
        url,
        ...(password ? { password } : {}),
        ...options,
    });
    return {
        addedTargets: result.added_targets,
        updatedTargets: result.updated_targets ?? 0,
        skippedTargets: result.skipped_targets,
        importedFavorites: result.imported_favorites,
        settings: result.settings ? readSettings(result.settings) : undefined,
    };
}

export interface UserDataImportOptions {
    import_settings: boolean;
    import_targets: boolean;
    import_favorites: boolean;
    target_conflict: "skip" | "overwrite";
}

export type UserDataImportErrorType =
    | "password_required"
    | "decrypt_failed"
    | "format"
    | "url"
    | "unknown";

export function getUserDataImportErrorType(
    error: unknown,
): UserDataImportErrorType {
    if (!error || typeof error !== "object") {
        return "format";
    }
    const value = error as {
        code?: unknown;
        message?: unknown;
        name?: unknown;
    };
    if (value.name === "SyntaxError") return "format";
    switch (String(value.code)) {
        case "6000":
            return "password_required";
        case "6001":
            return "decrypt_failed";
        case "6002":
        case "6003":
            return "url";
        case "6004":
            return "format";
        case "2":
            return "format";
    }
    const message = typeof value.message === "string" ? value.message : "";
    if (/password/i.test(message)) return "password_required";
    if (/json|invalid|unsupported|format/i.test(message)) return "format";
    return "unknown";
}
