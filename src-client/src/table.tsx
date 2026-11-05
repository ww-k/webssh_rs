import { ConfigProvider, theme } from "antd";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";

import "./App.css";
import "./styles/menu-page.css";

import DataTableDemo from "./components/DataTableDemo";
import useAppStore from "./store";

const { darkAlgorithm, defaultAlgorithm } = theme;

function TableDemoApp() {
    const appTheme = useAppStore((state) => state.theme);
    const setTheme = useAppStore((state) => state.setTheme);

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
                    appTheme === "dark" ? darkAlgorithm : defaultAlgorithm,
            }}
        >
            <DataTableDemo />
        </ConfigProvider>
    );
}

const rootEl = document.getElementById("root");
if (rootEl) {
    const root = createRoot(rootEl);
    void useAppStore.getState().loadPreferences().then(
        () => root.render(<TableDemoApp />),
        () => root.render(<TableDemoApp />),
    );
}
