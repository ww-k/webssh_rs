import type { ResolvedTheme } from "./store";

/** Select the CSS token set used by the application and its ui-sdk dialogs. */
export function applyThemeToRoot(resolvedTheme: ResolvedTheme) {
    const root = document.getElementById("root");
    if (!root) return;

    root.dataset.colorScheme = resolvedTheme;
}
