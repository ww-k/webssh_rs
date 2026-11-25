import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "./App.css";

import AppOverlayHost from "./components/AppOverlayHost";
import UiComponentShowcase from "./components/UiComponentShowcase";
import { applyThemeToRoot } from "./theme";

import type { ResolvedTheme } from "./store";

function ComponentShowcaseApp() {
    const [theme, setTheme] = useState<ResolvedTheme>("light");

    useLayoutEffect(() => {
        applyThemeToRoot(theme);
    }, [theme]);

    return (
        <>
            <UiComponentShowcase theme={theme} onThemeChange={setTheme} />
            <AppOverlayHost />
        </>
    );
}

const rootEl = document.getElementById("root");
if (rootEl) {
    const root = createRoot(rootEl);
    root.render(<ComponentShowcaseApp />);
}
