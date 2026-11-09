import type { Row, RowData } from "@tanstack/react-table";
import type { features } from "./table";

export const ROW_OVERSCAN = 10;
export const VIRTUAL_WINDOW_STEP = 8;

export function supportsNativeDragAndDrop() {
    if (typeof window === "undefined" || typeof document === "undefined") {
        return false;
    }
    const userAgent = navigator.userAgent;
    const isWebKitWebView =
        /AppleWebKit\//i.test(userAgent) &&
        !/(Safari|Chrome|CriOS|Edg|OPR|Firefox)\//i.test(userAgent);
    if (isWebKitWebView) return false;
    const probe = document.createElement("div");
    return (
        "draggable" in probe &&
        "ondragstart" in probe &&
        "ondragover" in probe &&
        "ondrop" in probe &&
        typeof window.DragEvent === "function" &&
        typeof window.DataTransfer === "function"
    );
}

export function getVirtualStartIndex(bodyScrollTop: number, rowHeight: number) {
    const firstVisibleIndex = Math.floor(bodyScrollTop / rowHeight);
    const windowStart =
        Math.floor(firstVisibleIndex / VIRTUAL_WINDOW_STEP) *
        VIRTUAL_WINDOW_STEP;
    return Math.max(0, windowStart - ROW_OVERSCAN);
}

export function currentSelectedRowsForDrag<TData extends RowData>(
    selectedRows: Row<typeof features, TData>[],
    row: Row<typeof features, TData>,
    original: TData,
) {
    return selectedRows.length && row.getIsSelected()
        ? selectedRows.map((item) => item.original)
        : [original];
}
