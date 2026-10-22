import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./i18n";

import App from "./App";
import useAppStore from "./store";

const rootEl = document.getElementById("root");
if (rootEl) {
    const root = createRoot(rootEl);
    const renderApp = () => {
        root.render(
            <StrictMode>
                <App />
            </StrictMode>,
        );
    };

    void useAppStore.getState().loadPreferences().then(renderApp, renderApp);
}
