import { Badge, ConfigProvider, Layout, Menu, theme } from "antd";
import { useCallback, useEffect, useMemo } from "react";

import "./App.css";

import { HomeOutlined, SwapOutlined } from "@ant-design/icons";

import useAppStore from "@/store";

import Home from "./components/Home";
import Transfer from "./components/Transfer";
import useTransferStore from "./services/transfer/store";

import type { MenuProps } from "antd";

const { darkAlgorithm, defaultAlgorithm } = theme;
const { Content, Sider } = Layout;

export default function App() {
    const transferListLen = useTransferStore((state) => state.list.length);
    const menusItems = useMemo<Required<MenuProps>["items"]>(() => {
        return [
            {
                key: "home",
                icon: <HomeOutlined />,
                label: "主页",
            },
            {
                key: "transfer",
                icon: <SwapOutlined style={{ transform: "rotate(90deg)" }} />,
                label: "传输",
                extra: <Badge count={transferListLen}></Badge>,
            },
        ];
    }, [transferListLen]);

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
            setMenuKey(evt.key);
        },
        [setMenuKey],
    );

    return (
        <ConfigProvider
            theme={{
                cssVar: true,
                hashed: false,
                algorithm: theme === "dark" ? darkAlgorithm : defaultAlgorithm,
            }}
        >
            <Layout style={{ height: "100vh" }}>
                <Sider
                    className="WebSSH-Root-Sider"
                    theme={theme}
                    collapsible={true}
                    defaultCollapsed={true}
                    collapsedWidth={60}
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
                    <Home />
                    {activeMenuKey === "transfer" && <Transfer />}
                </Content>
            </Layout>
        </ConfigProvider>
    );
}
