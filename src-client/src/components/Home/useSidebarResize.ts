import { useCallback, useRef, useState } from "react";

import {
    COLLAPSED_SIDEBAR_WIDTH,
    DEFAULT_SIDEBAR_WIDTH,
    EXPAND_THRESHOLD_OFFSET,
    MAX_SIDEBAR_WIDTH,
    MIN_SIDEBAR_WIDTH,
} from "./constants";

interface ResizeMove {
    moveX: number;
    moveY: number;
}

export default function useSidebarResize() {
    const [tabListCollapsed, setTabListCollapsed] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
    const [isResizingSidebar, setIsResizingSidebar] = useState(false);
    const sidebarWidthRef = useRef(sidebarWidth);
    const tabListCollapsedRef = useRef(tabListCollapsed);
    const sidebarResizeOriginRef = useRef<number | null>(null);

    sidebarWidthRef.current = sidebarWidth;
    tabListCollapsedRef.current = tabListCollapsed;

    const onSidebarResizeMoved = useCallback(() => {
        sidebarResizeOriginRef.current = null;
        setIsResizingSidebar(false);
    }, []);

    const onSidebarResizeMove = useCallback(({ moveX }: ResizeMove) => {
        const isCollapsed = tabListCollapsedRef.current;
        const origin =
            sidebarResizeOriginRef.current ??
            (isCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidthRef.current);
        sidebarResizeOriginRef.current = origin;
        const requestedWidth = origin + moveX;

        if (
            isCollapsed &&
            requestedWidth >= MIN_SIDEBAR_WIDTH - EXPAND_THRESHOLD_OFFSET
        ) {
            sidebarResizeOriginRef.current = MIN_SIDEBAR_WIDTH - moveX;
            sidebarWidthRef.current = MIN_SIDEBAR_WIDTH;
            setSidebarWidth(MIN_SIDEBAR_WIDTH);
            tabListCollapsedRef.current = false;
            setTabListCollapsed(false);
            setIsResizingSidebar(true);
            return;
        }
        if (isCollapsed) {
            setIsResizingSidebar(true);
            return;
        }
        if (
            !isCollapsed &&
            requestedWidth < COLLAPSED_SIDEBAR_WIDTH + EXPAND_THRESHOLD_OFFSET
        ) {
            sidebarResizeOriginRef.current = COLLAPSED_SIDEBAR_WIDTH - moveX;
            tabListCollapsedRef.current = true;
            setTabListCollapsed(true);
            setIsResizingSidebar(true);
            return;
        }

        setIsResizingSidebar(true);
        const nextWidth = Math.min(
            MAX_SIDEBAR_WIDTH,
            Math.max(MIN_SIDEBAR_WIDTH, requestedWidth),
        );
        setSidebarWidth(nextWidth);
    }, []);

    const sidebarStyle =
        tabListCollapsed || sidebarWidth === DEFAULT_SIDEBAR_WIDTH
            ? undefined
            : { flexBasis: `${sidebarWidth}px` };

    return {
        isResizingSidebar,
        onSidebarResizeMove,
        onSidebarResizeMoved,
        setTabListCollapsed,
        sidebarStyle,
        tabListCollapsed,
    };
}
