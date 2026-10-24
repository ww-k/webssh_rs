import {
    CodeOutlined,
    DatabaseOutlined,
    DownloadOutlined,
    LayoutOutlined,
    MoonOutlined,
    ReloadOutlined,
    SunOutlined,
    UploadOutlined,
} from "@ant-design/icons";
import {
    Button,
    ColorPicker,
    message,
    Segmented,
    Select,
    Space,
    Switch,
    Typography,
} from "antd";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import "./index.css";

import fileSave from "@/helpers/fileSave";
import { createUserDataExport, importUserData } from "@/services/userData";
import useAppStore, { type ResolvedTheme, type ThemeMode } from "@/store";

import { terminalThemeDefaults } from "../Terminal/constants";

import type { TerminalThemeColorKey } from "../Terminal/types";

const { Paragraph, Text, Title } = Typography;

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

    const renderTerminalTheme = (mode: ResolvedTheme) => (
        <div className="WebSSH-Settings-TerminalTheme">
            <div className="WebSSH-Settings-TerminalThemeHeader">
                <Text strong>
                    {t(
                        mode === "dark"
                            ? "settings_terminal_theme_dark"
                            : "settings_terminal_theme_light",
                    )}
                </Text>
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
                    <Text type="secondary">{t(label)}</Text>
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
        try {
            const data = await createUserDataExport({
                theme_mode: themeMode,
                sidebar_collapsed: sidebarCollapsed,
                show_terminal_copy_notification: showTerminalCopyNotification,
                terminal_selection_copy_enabled: terminalSelectionCopyEnabled,
                terminal_right_click_paste_enabled:
                    terminalRightClickAction === "paste",
                terminal_middle_click_paste_enabled:
                    terminalMiddleClickPasteEnabled,
                terminal_themes: terminalThemes,
                language,
            });
            fileSave(
                new Blob([JSON.stringify(data, null, 2)], {
                    type: "application/json",
                }),
                {
                    fileName: `webssh-user-data-${new Date().toISOString().slice(0, 10)}.json`,
                },
            );
            message.success(t("settings_data_export_success"));
        } catch {
            message.error(t("settings_data_export_failed"));
        }
    };

    const handleImport = async (file: File) => {
        try {
            const data = JSON.parse(await file.text()) as unknown;
            const result = await importUserData(data);
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
            message.success(
                t("settings_data_import_success", {
                    added: result.addedTargets,
                    skipped: result.skippedTargets,
                    favorites: result.importedFavorites,
                }),
            );
        } catch {
            message.error(t("settings_data_import_failed"));
        } finally {
            if (importInputRef.current) importInputRef.current.value = "";
        }
    };

    return (
        <main className="WebSSH-Settings">
            <div className="WebSSH-Settings-Header">
                <Title level={2}>{t("settings_title")}</Title>
                <Paragraph type="secondary">
                    {t("settings_description")}
                </Paragraph>
            </div>

            <section className="WebSSH-Settings-Section">
                <div className="WebSSH-Settings-SectionHeading">
                    <div className="WebSSH-Settings-SectionIcon">
                        <SunOutlined />
                    </div>
                    <div>
                        <Title level={4}>{t("settings_appearance")}</Title>
                        <Text type="secondary">
                            {t("settings_appearance_description")}
                        </Text>
                    </div>
                </div>

                <div className="WebSSH-Settings-Row">
                    <div className="WebSSH-Settings-RowText">
                        <Text strong>{t("settings_theme")}</Text>
                        <Text type="secondary">{t("settings_theme_help")}</Text>
                    </div>
                    <Segmented
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
                        <Text strong>{t("settings_language")}</Text>
                        <Text type="secondary">
                            {t("settings_language_help")}
                        </Text>
                    </div>
                    <Select
                        value={language}
                        style={{ width: 160 }}
                        options={[
                            {
                                value: "zh",
                                label: t("settings_language_zh"),
                            },
                            { value: "en", label: "English" },
                        ]}
                        onChange={(value: string) =>
                            setLanguage(value as "zh" | "en")
                        }
                    />
                </div>

                <div className="WebSSH-Settings-Row">
                    <div className="WebSSH-Settings-RowText">
                        <Text strong>
                            {t("settings_terminal_copy_notification")}
                        </Text>
                        <Text type="secondary">
                            {t("settings_terminal_copy_notification_help")}
                        </Text>
                    </div>
                    <Switch
                        checked={showTerminalCopyNotification}
                        onChange={setShowTerminalCopyNotification}
                    />
                </div>
            </section>

            <section className="WebSSH-Settings-Section">
                <div className="WebSSH-Settings-SectionHeading">
                    <div className="WebSSH-Settings-SectionIcon">
                        <CodeOutlined />
                    </div>
                    <div>
                        <Title level={4}>{t("settings_terminal")}</Title>
                        <Text type="secondary">
                            {t("settings_terminal_description")}
                        </Text>
                    </div>
                </div>

                <div className="WebSSH-Settings-Row">
                    <div className="WebSSH-Settings-RowText">
                        <Text strong>
                            {t("settings_terminal_selection_copy")}
                        </Text>
                        <Text type="secondary">
                            {t("settings_terminal_selection_copy_help")}
                        </Text>
                    </div>
                    <Switch
                        checked={terminalSelectionCopyEnabled}
                        onChange={setTerminalSelectionCopyEnabled}
                    />
                </div>

                <div className="WebSSH-Settings-Row">
                    <div className="WebSSH-Settings-RowText">
                        <Text strong>
                            {t("settings_terminal_right_click_action")}
                        </Text>
                        <Text type="secondary">
                            {t("settings_terminal_right_click_action_help")}
                        </Text>
                    </div>
                    <Segmented
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
                        <Text strong>
                            {t("settings_terminal_middle_click_paste")}
                        </Text>
                        <Text type="secondary">
                            {t("settings_terminal_middle_click_paste_help")}
                        </Text>
                    </div>
                    <Switch
                        checked={terminalMiddleClickPasteEnabled}
                        onChange={setTerminalMiddleClickPasteEnabled}
                    />
                </div>

                <div className="WebSSH-Settings-Row WebSSH-Settings-TerminalThemesRow">
                    <div className="WebSSH-Settings-RowText">
                        <Text strong>{t("settings_terminal_colors")}</Text>
                        <Text type="secondary">
                            {t("settings_terminal_colors_help")}
                        </Text>
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
                        <LayoutOutlined />
                    </div>
                    <div>
                        <Title level={4}>{t("settings_navigation")}</Title>
                        <Text type="secondary">
                            {t("settings_navigation_description")}
                        </Text>
                    </div>
                </div>

                <div className="WebSSH-Settings-Row">
                    <div className="WebSSH-Settings-RowText">
                        <Text strong>{t("settings_sidebar_collapsed")}</Text>
                        <Text type="secondary">
                            {t("settings_sidebar_collapsed_help")}
                        </Text>
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
                        <Title level={4}>{t("settings_data")}</Title>
                        <Text type="secondary">
                            {t("settings_data_description")}
                        </Text>
                    </div>
                </div>

                <div className="WebSSH-Settings-Row">
                    <div className="WebSSH-Settings-RowText">
                        <Text strong>{t("settings_data_transfer")}</Text>
                        <Text type="secondary">
                            {t("settings_data_transfer_help")}
                        </Text>
                    </div>
                    <Space wrap>
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
                    </Space>
                </div>
            </section>
        </main>
    );
}
