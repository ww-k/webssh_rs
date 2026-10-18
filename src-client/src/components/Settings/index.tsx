import { LayoutOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Segmented, Select, Switch, Typography } from "antd";
import { useTranslation } from "react-i18next";

import "./index.css";

import useAppStore, { type ThemeMode } from "@/store";

const { Paragraph, Text, Title } = Typography;

export default function Settings() {
    const { i18n, t } = useTranslation();
    const { themeMode, setTheme, sidebarCollapsed, setSidebarCollapsed } =
        useAppStore();
    const language = i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en";

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
                            { value: "zh", label: "中文" },
                            { value: "en", label: "English" },
                        ]}
                        onChange={(value: string) =>
                            void i18n.changeLanguage(value)
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
        </main>
    );
}
