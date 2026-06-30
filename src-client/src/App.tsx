import { Badge, ConfigProvider, Layout, Menu, theme } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";

import "./App.css";

import { HomeOutlined, SwapOutlined } from "@ant-design/icons";

import useAppStore from "@/store";

import Home from "./components/Home";
import Transfer from "./components/Transfer";
import transferService from "./services/transfer";

import type { MenuProps } from "antd";
import type { ITransferTask } from "./api";

const { darkAlgorithm, defaultAlgorithm } = theme;
const { Content, Sider } = Layout;

export default function App() {
    const [siderCollapsed, setSiderCollapsed] = useState(true);
    const [lastTransferMenuClickAt, setLastTransferMenuClickAt] = useState(0);
    const [transferTasks, setTransferTasks] = useState<ITransferTask[]>(() =>
        transferService.getTasks(),
    );
    const newTransferCount = useMemo(
        () =>
            transferTasks.filter(
                (item) =>
                    item.created_at &&
                    item.created_at > lastTransferMenuClickAt,
            ).length,
        [lastTransferMenuClickAt, transferTasks],
    );
    const menusItems = useMemo<Required<MenuProps>["items"]>(() => {
        return [
            {
                key: "home",
                icon: <HomeOutlined />,
                label: "主页",
            },
            {
                key: "transfer",
                icon: siderCollapsed ? (
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
                label: "传输",
                extra: !siderCollapsed ? (
                    <Badge count={newTransferCount}></Badge>
                ) : undefined,
            },
        ];
    }, [newTransferCount, siderCollapsed]);

    useEffect(() => {
        return transferService.subscribe(setTransferTasks);
    }, []);

    const {
        theme,
        setTheme,

        activeMenuKey,
        setMenuKey,
    } = useAppStore();

    // biome-ignore lint/correctness/useExhaustiveDependencies: setTheme不用加
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
        const handleSystemThemeChange = (event: MediaQueryListEvent) => {
            setTheme(event.matches ? "dark" : "light");
        };

        // 初始化设置主题
        setTheme(systemPrefersDark.matches ? "dark" : "light");
        systemPrefersDark.addEventListener("change", handleSystemThemeChange);

        return () => {
            document.body.removeEventListener("dragover", preventDefault);
            document.body.removeEventListener("drop", preventDefault);
            systemPrefersDark.removeEventListener(
                "change",
                handleSystemThemeChange,
            );
        };
    }, []);

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
                    collapsed={siderCollapsed}
                    collapsedWidth={60}
                    onCollapse={setSiderCollapsed}
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
                </Sider>
                <Content className="WebSSH-Root-Content">
                    <Home active={activeMenuKey === "home"} />
                    {activeMenuKey === "transfer" && <Transfer />}
                </Content>
            </Layout>
        </ConfigProvider>
    );
}
