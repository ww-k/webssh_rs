import { ConfigProvider, Layout, theme } from "antd";
import { useCallback, useEffect, useLayoutEffect } from "react";

import "./App.css";

import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { useTranslation } from "react-i18next";

import useAppStore from "@/store";
import { applyThemeToRoot } from "@/theme";

import AppOverlayHost from "./components/AppOverlayHost";
import Home from "./components/Home";
import PortForwarding from "./components/PortForwarding";
import ServerLogs from "./components/ServerLogs";
import Settings from "./components/Settings";
import Sidebar from "./components/Sidebar";
import SshConnections from "./components/SshConnections";
import SshKnownHosts from "./components/SshKnownHosts";
import Transfer from "./components/Transfer";

const { Content } = Layout;
export default function App() {
    const { i18n } = useTranslation();
    const appTheme = useAppStore((state) => state.theme);
    const setTheme = useAppStore((state) => state.setTheme);
    const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
    const setSidebarCollapsed = useAppStore(
        (state) => state.setSidebarCollapsed,
    );
    const activeMenuKey = useAppStore((state) => state.activeMenuKey);
    const setMenuKey = useAppStore((state) => state.setMenuKey);

    useLayoutEffect(() => {
        applyThemeToRoot(appTheme);
    }, [appTheme]);

    useEffect(() => {
        console.log("App init");
        window.onkeydown = (evt) => {
            console.log(
                `${evt.ctrlKey ? "Ctrl + " : ""}${evt.altKey ? "Alt + " : ""}${evt.shiftKey ? "Shift + " : ""}${
                    evt.metaKey ? "Meta + " : ""
                }${evt.key} ${evt.code}`,
            );
        };

        const preventDefault = (evt: DragEvent) => {
            evt.preventDefault();
            if (evt.dataTransfer) {
                evt.dataTransfer.dropEffect = "none";
            }
        };

        // 禁用拖入文件
        document.body.addEventListener("dragover", preventDefault, false);
        document.body.addEventListener("drop", preventDefault, false);

        // 获取系统的主体偏好设置
        const systemPrefersDark = window.matchMedia(
            "(prefers-color-scheme: dark)",
        );
        // 处理系统偏好变化的回调函数
        const handleSystemThemeChange = () => {
            if (useAppStore.getState().themeMode === "system") {
                setTheme("system");
            }
        };

        systemPrefersDark.addEventListener("change", handleSystemThemeChange);

        return () => {
            document.body.removeEventListener("dragover", preventDefault);
            document.body.removeEventListener("drop", preventDefault);
            systemPrefersDark.removeEventListener(
                "change",
                handleSystemThemeChange,
            );
        };
    }, [setTheme]);

    const handleMenuClick = useCallback(
        (evt: { key: string }) => {
            setMenuKey(evt.key);
        },
        [setMenuKey],
    );

    return (
        <ConfigProvider
            locale={i18n.resolvedLanguage?.startsWith("zh") ? zhCN : enUS}
            theme={{
                cssVar: {},
                hashed: false,
                algorithm:
                    appTheme === "dark"
                        ? theme.darkAlgorithm
                        : theme.defaultAlgorithm,
            }}
        >
            <Layout
                className="WebSSH-Root-Layout"
                style={{ height: "100vh", flexDirection: "row" }}
            >
                <Sidebar
                    activeMenuKey={activeMenuKey}
                    collapsed={sidebarCollapsed}
                    onCollapse={setSidebarCollapsed}
                    onMenuClick={handleMenuClick}
                />
                <Content className="WebSSH-Root-Content">
                    <Home active={activeMenuKey === "home"} />
                    {activeMenuKey === "transfer" && <Transfer />}
                    {activeMenuKey === "ssh_connections" && <SshConnections />}
                    {activeMenuKey === "port_forward" && <PortForwarding />}
                    {activeMenuKey === "server_logs" && <ServerLogs />}
                    {activeMenuKey === "ssh_known_hosts" && <SshKnownHosts />}
                    {activeMenuKey === "settings" && <Settings />}
                </Content>
            </Layout>
            <AppOverlayHost />
        </ConfigProvider>
    );
}
