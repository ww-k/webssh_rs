import { Badge, ConfigProvider, Layout, Menu, theme } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./App.css";

import { HomeOutlined, SettingOutlined, SwapOutlined } from "@ant-design/icons";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { useTranslation } from "react-i18next";

import useAppStore from "@/store";

import Home from "./components/Home";
import Settings from "./components/Settings";
import Transfer from "./components/Transfer";
import transferService from "./services/transfer";

import type { MenuProps } from "antd";
import type { ITransferTask } from "./api";

const { darkAlgorithm, defaultAlgorithm } = theme;
const { Content, Sider } = Layout;
const UNFINISHED_TRANSFER_STATUSES = new Set<ITransferTask["status"]>([
    "WAIT",
    "RUN",
    "PAUSE",
    "FAIL",
]);

export default function App() {
    const { t, i18n } = useTranslation();
    const {
        theme,
        setTheme,
        sidebarCollapsed,
        setSidebarCollapsed,
        activeMenuKey,
        setMenuKey,
        hydrateTabs,
    } = useAppStore();
    const pageOpenedAt = useRef(Date.now());
    const [lastTransferMenuClickAt, setLastTransferMenuClickAt] = useState(0);
    const [transferTasks, setTransferTasks] = useState<ITransferTask[]>(() =>
        transferService.getTasks(),
    );
    const newTransferCount = useMemo(() => {
        const createdAfter = Math.max(
            pageOpenedAt.current,
            lastTransferMenuClickAt,
        );
        return transferTasks.filter(
            (item) =>
                UNFINISHED_TRANSFER_STATUSES.has(item.status) ||
                (item.created_at && item.created_at > createdAfter),
        ).length;
    }, [lastTransferMenuClickAt, transferTasks]);
    const menusItems = useMemo<Required<MenuProps>["items"]>(() => {
        return [
            {
                key: "home",
                icon: <HomeOutlined />,
                label: t("app_menu_home"),
            },
            {
                key: "transfer",
                icon: sidebarCollapsed ? (
                    <span className="WebSSH-Root-TransferMenuIcon">
                        <SwapOutlined
                            className="ant-menu-item-icon"
                            style={{ transform: "rotate(90deg)" }}
                        />
                        {newTransferCount > 0 && (
                            <span className="WebSSH-Root-TransferMenuCount">
                                {newTransferCount > 99
                                    ? "99+"
                                    : newTransferCount}
                            </span>
                        )}
                    </span>
                ) : (
                    <SwapOutlined style={{ transform: "rotate(90deg)" }} />
                ),
                label: t("app_menu_transfer"),
                extra: !sidebarCollapsed ? (
                    <Badge count={newTransferCount}></Badge>
                ) : undefined,
            },
        ];
    }, [newTransferCount, sidebarCollapsed, t]);

    const settingsMenuItems = useMemo<Required<MenuProps>["items"]>(
        () => [
            {
                key: "settings",
                icon: <SettingOutlined />,
                label: t("app_menu_settings"),
            },
        ],
        [t],
    );

    useEffect(() => {
        return transferService.subscribe(setTransferTasks);
    }, []);

    useEffect(() => {
        void hydrateTabs();
    }, [hydrateTabs]);

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
            if (evt.key === "transfer") {
                setLastTransferMenuClickAt(Date.now());
            }
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
                algorithm: theme === "dark" ? darkAlgorithm : defaultAlgorithm,
            }}
        >
            <Layout style={{ height: "100vh" }}>
                <Sider
                    className="WebSSH-Root-Sider"
                    theme={theme}
                    collapsible={true}
                    collapsed={sidebarCollapsed}
                    collapsedWidth={60}
                    onCollapse={setSidebarCollapsed}
                >
                    <Menu
                        className="WebSSH-Root-Menu"
                        theme={theme}
                        mode="inline"
                        defaultSelectedKeys={["home"]}
                        selectedKeys={[activeMenuKey]}
                        items={menusItems}
                        onClick={handleMenuClick}
                    />
                    <Menu
                        className="WebSSH-Root-SettingsMenu"
                        theme={theme}
                        mode="inline"
                        selectedKeys={
                            activeMenuKey === "settings" ? ["settings"] : []
                        }
                        items={settingsMenuItems}
                        onClick={handleMenuClick}
                    />
                </Sider>
                <Content className="WebSSH-Root-Content">
                    <Home active={activeMenuKey === "home"} />
                    {activeMenuKey === "transfer" && <Transfer />}
                    {activeMenuKey === "settings" && <Settings />}
                </Content>
            </Layout>
        </ConfigProvider>
    );
}
