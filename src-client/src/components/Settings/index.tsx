import {
    AimOutlined,
    ApiOutlined,
    CodeOutlined,
    DatabaseOutlined,
    DownloadOutlined,
    LayoutOutlined,
    LinkOutlined,
    MoonOutlined,
    ReloadOutlined,
    SaveOutlined,
    SunOutlined,
    UploadOutlined,
} from "@ant-design/icons";
import { toast } from "@ui-sdk/react/toast";
import { ColorPicker, InputNumber, Switch } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import "./index.css";

import Button from "@/components/Button";
import Segmented from "@/components/Segmented";
import Select from "@/components/Select";
import fileSave from "@/helpers/fileSave";
import renderPrompt, {
    renderImportOptionsPrompt,
    renderUrlPasswordPrompt,
} from "@/helpers/renderPrompt";
import {
    DEFAULT_SERVER_PORT,
    getServerPort,
    isDesktopApp as isDesktopAppEnvironment,
    setServerPort,
} from "@/services/serverPort";
import {
    createUserDataExport,
    getUserDataImportErrorType,
    importUserData,
    importUserDataFromUrl,
} from "@/services/userData";
import useAppStore, {
    type ResolvedTheme,
    type TargetDoubleClickAction,
    type ThemeMode,
} from "@/store";

import { terminalThemeDefaults } from "../Terminal/constants";

import type { TerminalThemeColorKey } from "../Terminal/types";

const terminalThemeColorFields: Array<{
    key: TerminalThemeColorKey;
    label: string;
}> = [
    { key: "background", label: "settings_terminal_color_background" },
    { key: "foreground", label: "settings_terminal_color_foreground" },
    { key: "cursor", label: "settings_terminal_color_cursor" },
    {
        key: "selectionBackground",
        label: "settings_terminal_color_selection",
    },
    { key: "scrollbarThumb", label: "settings_terminal_color_scrollbar" },
];

export default function Settings() {
    const { t } = useTranslation();
    const desktopApp = isDesktopAppEnvironment();
    const [serverPort, setServerPortValue] = useState(DEFAULT_SERVER_PORT);
    const [serverPortSaving, setServerPortSaving] = useState(false);
    const { themeMode, setTheme, sidebarCollapsed, setSidebarCollapsed } =
        useAppStore();
    const {
        showTerminalCopyNotification,
        setShowTerminalCopyNotification,
        terminalSelectionCopyEnabled,
        setTerminalSelectionCopyEnabled,
        terminalRightClickAction,
        setTerminalRightClickAction,
        terminalMiddleClickPasteEnabled,
        setTerminalMiddleClickPasteEnabled,
        targetDoubleClickAction,
        setTargetDoubleClickAction,
        terminalThemes,
        setTerminalThemeColor,
        language,
        setLanguage,
    } = useAppStore();

    const resetTerminalTheme = (mode: ResolvedTheme) => {
        for (const { key } of terminalThemeColorFields) {
            setTerminalThemeColor(mode, key, terminalThemeDefaults[mode][key]);
        }
    };

    useEffect(() => {
        if (!desktopApp) return;
        void getServerPort()
            .then((port) => {
                if (port >= 1 && port <= 65535) setServerPortValue(port);
            })
            .catch(() => undefined);
    }, [desktopApp]);

    const handleServerPortSave = async () => {
        if (
            !Number.isInteger(serverPort) ||
            serverPort < 1 ||
            serverPort > 65535
        ) {
            toast.error(t("settings_server_port_invalid"));
            return;
        }
        setServerPortSaving(true);
        try {
            await setServerPort(serverPort);
            toast.success(t("settings_server_port_saved"));
        } catch {
            toast.error(t("settings_server_port_save_failed"));
        } finally {
            setServerPortSaving(false);
        }
    };

    const renderTerminalTheme = (mode: ResolvedTheme) => (
        <div className="WebSSH-Settings-TerminalTheme">
            <div className="WebSSH-Settings-TerminalThemeHeader">
                <span className="webssh-typography webssh-typography-text webssh-typography-strong">
                    {t(
                        mode === "dark"
                            ? "settings_terminal_theme_dark"
                            : "settings_terminal_theme_light",
                    )}
                </span>
                <Button
                    icon={<ReloadOutlined />}
                    onClick={() => resetTerminalTheme(mode)}
                    size="small"
                >
                    {t("settings_terminal_colors_reset")}
                </Button>
            </div>
            {terminalThemeColorFields.map(({ key, label }) => (
                <div className="WebSSH-Settings-TerminalColor" key={key}>
                    <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                        {t(label)}
                    </span>
                    <ColorPicker
                        style={{ width: 130 }}
                        value={terminalThemes[mode][key]}
                        showText
                        onChangeComplete={(color) =>
                            setTerminalThemeColor(
                                mode,
                                key,
                                color.toRgbString(),
                            )
                        }
                    />
                </div>
            ))}
        </div>
    );
    const importInputRef = useRef<HTMLInputElement>(null);
    const handleExport = async () => {
        const password = await renderPrompt({
            title: t("settings_data_export_password_title"),
            okText: t("app_btn_ok"),
            cancelText: t("app_btn_cancel"),
            password: true,
        });
        if (password === undefined) return;
        try {
            const data = await createUserDataExport(
                {
                    theme_mode: themeMode,
                    sidebar_collapsed: sidebarCollapsed,
                    show_terminal_copy_notification:
                        showTerminalCopyNotification,
                    terminal_selection_copy_enabled:
                        terminalSelectionCopyEnabled,
                    terminal_right_click_paste_enabled:
                        terminalRightClickAction === "paste",
                    terminal_middle_click_paste_enabled:
                        terminalMiddleClickPasteEnabled,
                    target_double_click_action: targetDoubleClickAction,
                    terminal_themes: terminalThemes,
                    language,
                },
                password,
            );
            fileSave(
                new Blob([JSON.stringify(data, null, 2)], {
                    type: "application/json",
                }),
                {
                    fileName: `webssh-user-data-${new Date().toISOString().slice(0, 10)}.json`,
                },
            );
            toast.success(t("settings_data_export_success"));
        } catch {
            toast.error(t("settings_data_export_failed"));
        }
    };

    const applyImportedData = (
        result: Awaited<ReturnType<typeof importUserData>>,
    ) => {
        if (!result.settings) {
            window.dispatchEvent(new Event("webssh:user-data-imported"));
            toast.success(
                t("settings_data_import_success", {
                    added: result.addedTargets,
                    updated: result.updatedTargets,
                    skipped: result.skippedTargets,
                    favorites: result.importedFavorites,
                    portForwards: result.importedPortForwards,
                }),
            );
            return;
        }
        setTheme(result.settings.theme_mode);
        setSidebarCollapsed(result.settings.sidebar_collapsed);
        setShowTerminalCopyNotification(
            result.settings.show_terminal_copy_notification,
        );
        setTerminalSelectionCopyEnabled(
            result.settings.terminal_selection_copy_enabled,
        );
        setTerminalRightClickAction(
            result.settings.terminal_right_click_paste_enabled
                ? "paste"
                : "menu",
        );
        setTerminalMiddleClickPasteEnabled(
            result.settings.terminal_middle_click_paste_enabled,
        );
        setTargetDoubleClickAction(
            result.settings
                .target_double_click_action as TargetDoubleClickAction,
        );
        for (const mode of ["light", "dark"] as const) {
            for (const { key } of terminalThemeColorFields) {
                setTerminalThemeColor(
                    mode,
                    key,
                    result.settings.terminal_themes[mode][key],
                );
            }
        }
        setLanguage(result.settings.language as "zh" | "en");
        toast.success(
            t("settings_data_import_success", {
                added: result.addedTargets,
                updated: result.updatedTargets,
                skipped: result.skippedTargets,
                favorites: result.importedFavorites,
                portForwards: result.importedPortForwards,
            }),
        );
        window.dispatchEvent(new Event("webssh:user-data-imported"));
    };

    const importData = async (data: unknown) => {
        const record =
            data && typeof data === "object" && !Array.isArray(data)
                ? (data as Record<string, unknown>)
                : undefined;
        const encrypted =
            typeof record?.algorithm === "string" &&
            typeof record?.salt === "string" &&
            typeof record?.nonce === "string" &&
            typeof record?.ciphertext === "string";
        const password = encrypted
            ? await renderPrompt({
                  title: t("settings_data_import_password_title"),
                  okText: t("app_btn_ok"),
                  cancelText: t("app_btn_cancel"),
                  password: true,
              })
            : undefined;
        if (encrypted && password === undefined) return;
        const importOptions = await renderImportOptionsPrompt({
            title: t("settings_data_import_options_title"),
            settingsLabel: t("settings_data_import_category_settings"),
            targetsLabel: t("settings_data_import_category_targets"),
            favoritesLabel: t("settings_data_import_category_favorites"),
            portForwardsLabel: t("settings_data_import_category_port_forwards"),
            conflictLabel: t("settings_data_import_target_conflict"),
            skipLabel: t("settings_data_import_target_skip"),
            overwriteLabel: t("settings_data_import_target_overwrite"),
            okText: t("app_btn_ok"),
            cancelText: t("app_btn_cancel"),
        });
        if (!importOptions) return;
        const result = await importUserData(data, password, importOptions);
        applyImportedData(result);
    };

    const handleImport = async (file: File) => {
        try {
            await importData(JSON.parse(await file.text()) as unknown);
        } catch (error) {
            toast.error(
                t(
                    `settings_data_import_error_${getUserDataImportErrorType(
                        error,
                    )}`,
                ),
            );
        } finally {
            if (importInputRef.current) importInputRef.current.value = "";
        }
    };

    const handleImportFromUrl = async () => {
        const value = await renderUrlPasswordPrompt({
            title: t("settings_data_import_url_title"),
            urlPlaceholder: t("settings_data_import_url_placeholder"),
            passwordPlaceholder: t(
                "settings_data_import_url_password_placeholder",
            ),
            okText: t("app_btn_ok"),
            cancelText: t("app_btn_cancel"),
        });
        const url = value?.url.trim();
        if (!url) return;

        try {
            const importOptions = await renderImportOptionsPrompt({
                title: t("settings_data_import_options_title"),
                settingsLabel: t("settings_data_import_category_settings"),
                targetsLabel: t("settings_data_import_category_targets"),
                favoritesLabel: t("settings_data_import_category_favorites"),
                portForwardsLabel: t(
                    "settings_data_import_category_port_forwards",
                ),
                conflictLabel: t("settings_data_import_target_conflict"),
                skipLabel: t("settings_data_import_target_skip"),
                overwriteLabel: t("settings_data_import_target_overwrite"),
                okText: t("app_btn_ok"),
                cancelText: t("app_btn_cancel"),
            });
            if (!importOptions) return;
            const result = await importUserDataFromUrl(
                url,
                value?.password || undefined,
                importOptions,
            );
            applyImportedData(result);
        } catch (error) {
            toast.error(
                t(
                    `settings_data_import_url_error_${getUserDataImportErrorType(
                        error,
                    )}`,
                ),
            );
        }
    };

    return (
        <main className="WebSSH-Settings">
            <div className="WebSSH-Settings-Header">
                <h2 className="webssh-typography webssh-typography-title">
                    {t("settings_title")}
                </h2>
                <p className="webssh-typography webssh-typography-paragraph webssh-typography-secondary">
                    {t("settings_description")}
                </p>
            </div>

            <section className="WebSSH-Settings-Section">
                <div className="WebSSH-Settings-SectionHeading">
                    <div className="WebSSH-Settings-SectionIcon">
                        <SunOutlined />
                    </div>
                    <div>
                        <h4 className="webssh-typography webssh-typography-title">
                            {t("settings_appearance")}
                        </h4>
                        <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                            {t("settings_appearance_description")}
                        </span>
                    </div>
                </div>

                <div className="WebSSH-Settings-Row">
                    <div className="WebSSH-Settings-RowText">
                        <span className="webssh-typography webssh-typography-text webssh-typography-strong">
                            {t("settings_theme")}
                        </span>
                        <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                            {t("settings_theme_help")}
                        </span>
                    </div>
                    <Segmented
                        aria-label={t("settings_theme")}
                        value={themeMode}
                        onChange={(value) => setTheme(value as ThemeMode)}
                        options={[
                            {
                                value: "light",
                                icon: <SunOutlined />,
                                label: t("settings_theme_light"),
                            },
                            {
                                value: "dark",
                                icon: <MoonOutlined />,
                                label: t("settings_theme_dark"),
                            },
                            {
                                value: "system",
                                label: t("settings_theme_system"),
                            },
                        ]}
                    />
                </div>

                <div className="WebSSH-Settings-Row">
                    <div className="WebSSH-Settings-RowText">
                        <span className="webssh-typography webssh-typography-text webssh-typography-strong">
                            {t("settings_language")}
                        </span>
                        <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                            {t("settings_language_help")}
                        </span>
                    </div>
                    <Select
                        aria-label={t("settings_language")}
                        value={language}
                        style={{ width: 160 }}
                        options={[
                            {
                                value: "zh",
                                label: t("settings_language_zh"),
                            },
                            { value: "en", label: "English" },
                        ]}
                        onChange={(value) => {
                            if (value === "zh" || value === "en") {
                                setLanguage(value);
                            }
                        }}
                    />
                </div>

                <div className="WebSSH-Settings-Row">
                    <div className="WebSSH-Settings-RowText">
                        <span className="webssh-typography webssh-typography-text webssh-typography-strong">
                            {t("settings_terminal_copy_notification")}
                        </span>
                        <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                            {t("settings_terminal_copy_notification_help")}
                        </span>
                    </div>
                    <Switch
                        checked={showTerminalCopyNotification}
                        onChange={setShowTerminalCopyNotification}
                    />
                </div>
            </section>

            {desktopApp && (
                <section className="WebSSH-Settings-Section">
                    <div className="WebSSH-Settings-SectionHeading">
                        <div className="WebSSH-Settings-SectionIcon">
                            <ApiOutlined />
                        </div>
                        <div>
                            <h4 className="webssh-typography webssh-typography-title">
                                {t("settings_server")}
                            </h4>
                            <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                                {t("settings_server_description")}
                            </span>
                        </div>
                    </div>

                    <div className="WebSSH-Settings-Row">
                        <div className="WebSSH-Settings-RowText">
                            <span className="webssh-typography webssh-typography-text webssh-typography-strong">
                                {t("settings_server_port")}
                            </span>
                            <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                                {t("settings_server_port_help")}
                            </span>
                        </div>
                        <div className="WebSSH-Stack">
                            <InputNumber
                                min={1}
                                max={65535}
                                precision={0}
                                value={serverPort}
                                onChange={(value) => {
                                    if (typeof value === "number") {
                                        setServerPortValue(value);
                                    }
                                }}
                            />
                            <Button
                                icon={<SaveOutlined />}
                                loading={serverPortSaving}
                                onClick={() => void handleServerPortSave()}
                            >
                                {t("settings_server_port_save")}
                            </Button>
                        </div>
                    </div>
                </section>
            )}

            <section className="WebSSH-Settings-Section">
                <div className="WebSSH-Settings-SectionHeading">
                    <div className="WebSSH-Settings-SectionIcon">
                        <CodeOutlined />
                    </div>
                    <div>
                        <h4 className="webssh-typography webssh-typography-title">
                            {t("settings_terminal")}
                        </h4>
                        <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                            {t("settings_terminal_description")}
                        </span>
                    </div>
                </div>

                <div className="WebSSH-Settings-Row">
                    <div className="WebSSH-Settings-RowText">
                        <span className="webssh-typography webssh-typography-text webssh-typography-strong">
                            {t("settings_terminal_selection_copy")}
                        </span>
                        <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                            {t("settings_terminal_selection_copy_help")}
                        </span>
                    </div>
                    <Switch
                        checked={terminalSelectionCopyEnabled}
                        onChange={setTerminalSelectionCopyEnabled}
                    />
                </div>

                <div className="WebSSH-Settings-Row">
                    <div className="WebSSH-Settings-RowText">
                        <span className="webssh-typography webssh-typography-text webssh-typography-strong">
                            {t("settings_terminal_right_click_action")}
                        </span>
                        <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                            {t("settings_terminal_right_click_action_help")}
                        </span>
                    </div>
                    <Segmented
                        aria-label={t("settings_terminal_right_click_action")}
                        value={terminalRightClickAction}
                        options={[
                            {
                                value: "paste",
                                label: t(
                                    "settings_terminal_right_click_action_paste",
                                ),
                            },
                            {
                                value: "menu",
                                label: t(
                                    "settings_terminal_right_click_action_menu",
                                ),
                            },
                        ]}
                        onChange={(value) =>
                            setTerminalRightClickAction(
                                value as "paste" | "menu",
                            )
                        }
                    />
                </div>

                <div className="WebSSH-Settings-Row">
                    <div className="WebSSH-Settings-RowText">
                        <span className="webssh-typography webssh-typography-text webssh-typography-strong">
                            {t("settings_terminal_middle_click_paste")}
                        </span>
                        <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                            {t("settings_terminal_middle_click_paste_help")}
                        </span>
                    </div>
                    <Switch
                        checked={terminalMiddleClickPasteEnabled}
                        onChange={setTerminalMiddleClickPasteEnabled}
                    />
                </div>

                <div className="WebSSH-Settings-Row WebSSH-Settings-TerminalThemesRow">
                    <div className="WebSSH-Settings-RowText">
                        <span className="webssh-typography webssh-typography-text webssh-typography-strong">
                            {t("settings_terminal_colors")}
                        </span>
                        <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                            {t("settings_terminal_colors_help")}
                        </span>
                    </div>
                    <div className="WebSSH-Settings-TerminalThemes">
                        {renderTerminalTheme("light")}
                        {renderTerminalTheme("dark")}
                    </div>
                </div>
            </section>

            <section className="WebSSH-Settings-Section">
                <div className="WebSSH-Settings-SectionHeading">
                    <div className="WebSSH-Settings-SectionIcon">
                        <AimOutlined />
                    </div>
                    <div>
                        <h4 className="webssh-typography webssh-typography-title">
                            {t("settings_targets")}
                        </h4>
                        <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                            {t("settings_targets_description")}
                        </span>
                    </div>
                </div>

                <div className="WebSSH-Settings-Row">
                    <div className="WebSSH-Settings-RowText">
                        <span className="webssh-typography webssh-typography-text webssh-typography-strong">
                            {t("settings_target_double_click")}
                        </span>
                        <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                            {t("settings_target_double_click_help")}
                        </span>
                    </div>
                    <Segmented
                        aria-label={t("settings_target_double_click")}
                        value={targetDoubleClickAction}
                        options={[
                            {
                                value: "ssh",
                                label: t("settings_target_double_click_ssh"),
                            },
                            {
                                value: "sftp",
                                label: t("settings_target_double_click_sftp"),
                            },
                        ]}
                        onChange={(value) =>
                            setTargetDoubleClickAction(
                                value as TargetDoubleClickAction,
                            )
                        }
                    />
                </div>
            </section>

            <section className="WebSSH-Settings-Section">
                <div className="WebSSH-Settings-SectionHeading">
                    <div className="WebSSH-Settings-SectionIcon">
                        <LayoutOutlined />
                    </div>
                    <div>
                        <h4 className="webssh-typography webssh-typography-title">
                            {t("settings_navigation")}
                        </h4>
                        <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                            {t("settings_navigation_description")}
                        </span>
                    </div>
                </div>

                <div className="WebSSH-Settings-Row">
                    <div className="WebSSH-Settings-RowText">
                        <span className="webssh-typography webssh-typography-text webssh-typography-strong">
                            {t("settings_sidebar_collapsed")}
                        </span>
                        <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                            {t("settings_sidebar_collapsed_help")}
                        </span>
                    </div>
                    <Switch
                        checked={sidebarCollapsed}
                        onChange={setSidebarCollapsed}
                    />
                </div>
            </section>

            <section className="WebSSH-Settings-Section">
                <div className="WebSSH-Settings-SectionHeading">
                    <div className="WebSSH-Settings-SectionIcon">
                        <DatabaseOutlined />
                    </div>
                    <div>
                        <h4 className="webssh-typography webssh-typography-title">
                            {t("settings_data")}
                        </h4>
                        <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                            {t("settings_data_description")}
                        </span>
                    </div>
                </div>

                <div className="WebSSH-Settings-Row">
                    <div className="WebSSH-Settings-RowText">
                        <span className="webssh-typography webssh-typography-text webssh-typography-strong">
                            {t("settings_data_transfer")}
                        </span>
                        <span className="webssh-typography webssh-typography-text webssh-typography-secondary">
                            {t("settings_data_transfer_help")}
                        </span>
                    </div>
                    <div className="WebSSH-Stack WebSSH-Stack--wrap">
                        <Button
                            icon={<DownloadOutlined />}
                            onClick={() => void handleExport()}
                        >
                            {t("settings_data_export")}
                        </Button>
                        <Button
                            icon={<UploadOutlined />}
                            onClick={() => importInputRef.current?.click()}
                        >
                            {t("settings_data_import")}
                        </Button>
                        <Button
                            icon={<LinkOutlined />}
                            onClick={() => void handleImportFromUrl()}
                        >
                            {t("settings_data_import_url")}
                        </Button>
                        <input
                            ref={importInputRef}
                            type="file"
                            accept="application/json,.json"
                            hidden
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) void handleImport(file);
                            }}
                        />
                    </div>
                </div>
            </section>
        </main>
    );
}
