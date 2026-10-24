import {
    CodeOutlined,
    DatabaseOutlined,
    DownloadOutlined,
    LayoutOutlined,
    MoonOutlined,
    SunOutlined,
    UploadOutlined,
} from "@ant-design/icons";
import {
    Button,
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
import useAppStore, { type ThemeMode } from "@/store";

const { Paragraph, Text, Title } = Typography;

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
        language,
        setLanguage,
    } = useAppStore();
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
