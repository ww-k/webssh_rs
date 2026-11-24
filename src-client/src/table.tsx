import { App as AntdApp, ConfigProvider, theme } from "antd";
import { useEffect, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";

import "./App.css";

import AppOverlayHost from "./components/AppOverlayHost";
import DataTableDemo from "./components/DataTableDemo";
import useAppStore from "./store";
import { applyThemeToRoot } from "./theme";

function TableDemoApp() {
    const appTheme = useAppStore((state) => state.theme);
    const setTheme = useAppStore((state) => state.setTheme);

    useLayoutEffect(() => {
        applyThemeToRoot(appTheme);
    }, [appTheme]);

    useEffect(() => {
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const handleThemeChange = () => {
            if (useAppStore.getState().themeMode === "system") {
                setTheme("system");
            }
        };
        media.addEventListener("change", handleThemeChange);
        return () => media.removeEventListener("change", handleThemeChange);
    }, [setTheme]);

    return (
        <ConfigProvider
            theme={{
                cssVar: {},
                hashed: false,
                algorithm:
                    appTheme === "dark"
                        ? theme.darkAlgorithm
                        : theme.defaultAlgorithm,
            }}
        >
            <AntdApp>
                <DataTableDemo />
            </AntdApp>
            <AppOverlayHost />
        </ConfigProvider>
    );
}

const rootEl = document.getElementById("root");
if (rootEl) {
    const root = createRoot(rootEl);
    void useAppStore
        .getState()
        .loadPreferences()
        .then(
            () => root.render(<TableDemoApp />),
            () => root.render(<TableDemoApp />),
        );
}
