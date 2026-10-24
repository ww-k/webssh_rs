import {
    ClearOutlined,
    CloseOutlined,
    CopyOutlined,
    EyeInvisibleOutlined,
    FolderOutlined,
    ReloadOutlined,
    SnippetsOutlined,
} from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useTranslation } from "react-i18next";

import "./index.css";

import { normalizeTerminalCwd } from "@/helpers/terminal_cwd";
import useAppStore, { type ITab } from "@/store";

import popContextMenu from "../Contextmenu";
import { terminalInteractionMessageType } from "./constants";

import type { IContextmenuDataItem } from "../Contextmenu/typings";

const terminalMessageType = "webssh:terminal-cwd";
const terminalStatusMessageType = "webssh:terminal-status";
const terminalCopyMessageType = "webssh:terminal-copy";
const terminalOutputMessageType = "webssh:terminal-output";
const terminalContextMenuMessageType = "webssh:terminal-contextmenu";
const maxTerminalHistoryLength = 256 * 1024;

function appendTerminalHistory(chunks: string[], data: string, length: number) {
    chunks.push(data);
    let nextLength = length + data.length;

    while (nextLength > maxTerminalHistoryLength && chunks.length > 1) {
        const removed = chunks.shift();
        nextLength -= removed?.length || 0;
    }

    return nextLength;
}

export default function Terminal({
    active,
    tab,
}: {
    active: boolean;
    tab: ITab;
}) {
    const { t } = useTranslation();
    const openSftpAt = useAppStore((state) => state.openSftpAt);
    const theme = useAppStore((state) => state.theme);
    const terminalThemes = useAppStore((state) => state.terminalThemes);
    const terminalSelectionCopyEnabled = useAppStore(
        (state) => state.terminalSelectionCopyEnabled,
    );
    const terminalRightClickAction = useAppStore(
        (state) => state.terminalRightClickAction,
    );
    const terminalMiddleClickPasteEnabled = useAppStore(
        (state) => state.terminalMiddleClickPasteEnabled,
    );
    const showTerminalCopyNotification = useAppStore(
        (state) => state.showTerminalCopyNotification,
    );
    const setShowTerminalCopyNotification = useAppStore(
        (state) => state.setShowTerminalCopyNotification,
    );
    const [cwd, setCwd] = useState<string>();
    const [connectionStatus, setConnectionStatus] = useState<
        "connected" | "disconnected" | "connecting"
    >("connecting");
    const [iframeKey, setIframeKey] = useState(0);
    const [copyNotificationVisible, setCopyNotificationVisible] =
        useState(false);
    const copyNotificationTimerRef = useRef<number>();
    const copyNotificationHoveredRef = useRef(false);
    const copyNotificationExpiresAtRef = useRef(0);
    const copyNotificationRemainingRef = useRef(2200);

    const initialCwd = useMemo(() => {
        const value = tab.state?.initialCwd;
        return typeof value === "string" && value.startsWith("/")
            ? value
            : undefined;
    }, [tab.state?.initialCwd]);
    const url = useMemo(
        () => tab.path.replace("/terminal/", "terminal.html?target_id="),
        [tab.path],
    );
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const terminalContextMenuDestroyRef = useRef<(() => void) | undefined>();
    const terminalHistoryChunksRef = useRef<string[]>([]);
    const terminalHistoryLengthRef = useRef(0);
    const targetId = useMemo(() => {
        const match = tab.path.match(/^\/terminal\/(\d+)/);
        return match ? Number.parseInt(match[1], 10) : undefined;
    }, [tab.path]);

    const clearCopyNotificationTimer = useCallback(() => {
        if (copyNotificationTimerRef.current) {
            window.clearTimeout(copyNotificationTimerRef.current);
            copyNotificationTimerRef.current = undefined;
        }
    }, []);

    const scheduleCopyNotification = useCallback(() => {
        clearCopyNotificationTimer();
        if (copyNotificationHoveredRef.current) return;

        const remaining = copyNotificationRemainingRef.current;
        copyNotificationExpiresAtRef.current = Date.now() + remaining;
        copyNotificationTimerRef.current = window.setTimeout(() => {
            setCopyNotificationVisible(false);
            copyNotificationRemainingRef.current = 0;
            copyNotificationTimerRef.current = undefined;
        }, remaining);
    }, [clearCopyNotificationTimer]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (
                !event.data ||
                event.origin !== window.location.origin ||
                event.source !== iframeRef.current?.contentWindow
            ) {
                return;
            }

            const data = event.data;
            if (
                data.type === terminalInteractionMessageType &&
                data.targetId === targetId
            ) {
                terminalContextMenuDestroyRef.current?.();
                terminalContextMenuDestroyRef.current = undefined;
                return;
            }

            if (
                data.type === terminalStatusMessageType &&
                data.targetId === targetId &&
                (data.status === "connected" || data.status === "disconnected")
            ) {
                setConnectionStatus(data.status);
                return;
            }

            if (
                data.type === terminalOutputMessageType &&
                data.targetId === targetId &&
                typeof data.data === "string"
            ) {
                terminalHistoryLengthRef.current = appendTerminalHistory(
                    terminalHistoryChunksRef.current,
                    data.data,
                    terminalHistoryLengthRef.current,
                );
                return;
            }

            if (
                data.type === terminalContextMenuMessageType &&
                data.targetId === targetId &&
                typeof data.x === "number" &&
                typeof data.y === "number"
            ) {
                const iframe = iframeRef.current;
                if (!iframe) return;

                const rect = iframe.getBoundingClientRect();
                const postCommand = (command: string, args?: string) => {
                    iframe.contentWindow?.postMessage(
                        { command, ...(args === undefined ? {} : { args }) },
                        window.location.origin,
                    );
                };
                const focusTerminal = () => postCommand("focus");
                const menus: IContextmenuDataItem[] = [
                    {
                        label: t("files_menu_copy"),
                        disabled: data.hasSelection !== true,
                        click: () => {
                            if (
                                typeof data.selection !== "string" ||
                                !data.selection
                            ) {
                                return;
                            }
                            void navigator.clipboard
                                .writeText(data.selection)
                                .then(() => {
                                    if (!showTerminalCopyNotification) {
                                        return;
                                    }
                                    setCopyNotificationVisible(true);
                                    copyNotificationRemainingRef.current = 2200;
                                    scheduleCopyNotification();
                                })
                                .catch(() => undefined)
                                .finally(focusTerminal);
                        },
                        iconRender: () => <CopyOutlined />,
                    },
                    {
                        label: t("files_menu_paste"),
                        click: () => {
                            void navigator.clipboard
                                .readText()
                                .then((text) => postCommand("pasteText", text))
                                .catch(() => undefined)
                                .finally(focusTerminal);
                        },
                        iconRender: () => <SnippetsOutlined />,
                    },
                    {
                        label: t("terminal_menu_clear"),
                        click: () => {
                            postCommand("clear");
                            focusTerminal();
                        },
                        iconRender: () => <ClearOutlined />,
                    },
                ];
                terminalContextMenuDestroyRef.current?.();
                terminalContextMenuDestroyRef.current = popContextMenu(
                    menus,
                    rect.left + data.x,
                    rect.top + data.y,
                ).destroy;
                return;
            }

            if (
                data.type === terminalCopyMessageType &&
                data.targetId === targetId
            ) {
                if (!showTerminalCopyNotification) return;
                setCopyNotificationVisible(true);
                copyNotificationRemainingRef.current = 2200;
                scheduleCopyNotification();
                return;
            }

            if (
                data.type === terminalMessageType &&
                data.targetId === targetId &&
                typeof data.cwd === "string"
            ) {
                const nextCwd = normalizeTerminalCwd(data.cwd);
                if (nextCwd) setCwd(nextCwd);
                return;
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [scheduleCopyNotification, showTerminalCopyNotification, t, targetId]);

    useEffect(() => {
        return () => {
            terminalContextMenuDestroyRef.current?.();
            terminalContextMenuDestroyRef.current = undefined;
        };
    }, []);

    useEffect(() => {
        if (!showTerminalCopyNotification) {
            setCopyNotificationVisible(false);
            clearCopyNotificationTimer();
        }
    }, [clearCopyNotificationTimer, showTerminalCopyNotification]);

    useEffect(() => {
        return () => {
            clearCopyNotificationTimer();
        };
    }, [clearCopyNotificationTimer]);

    const handleCopyNotificationMouseEnter = useCallback(() => {
        copyNotificationHoveredRef.current = true;
        if (copyNotificationTimerRef.current) {
            const remaining = Math.max(
                0,
                copyNotificationExpiresAtRef.current - Date.now(),
            );
            copyNotificationRemainingRef.current = remaining;
        }
        clearCopyNotificationTimer();
    }, [clearCopyNotificationTimer]);

    const handleCopyNotificationMouseLeave = useCallback(() => {
        copyNotificationHoveredRef.current = false;
        if (copyNotificationVisible) {
            scheduleCopyNotification();
        }
    }, [copyNotificationVisible, scheduleCopyNotification]);

    const closeCopyNotification = useCallback(() => {
        setCopyNotificationVisible(false);
        clearCopyNotificationTimer();
        copyNotificationRemainingRef.current = 0;
    }, [clearCopyNotificationTimer]);

    const disableCopyNotification = useCallback(() => {
        setShowTerminalCopyNotification(false);
        closeCopyNotification();
    }, [closeCopyNotification, setShowTerminalCopyNotification]);

    const openSftp = useCallback(() => {
        if (targetId === undefined || !cwd) return;
        openSftpAt(targetId, cwd, tab.key);
    }, [cwd, openSftpAt, tab.key, targetId]);

    const clearTerminal = useCallback(() => {
        const contentWindow = iframeRef.current?.contentWindow;
        if (!contentWindow) return;
        contentWindow.postMessage({ command: "clear" }, window.location.origin);
        contentWindow.postMessage({ command: "focus" }, window.location.origin);
    }, []);

    const syncTerminal = useCallback(() => {
        const contentWindow = iframeRef.current?.contentWindow;
        if (!contentWindow) return;

        contentWindow.postMessage(
            { command: "setTheme", args: terminalThemes[theme] },
            window.location.origin,
        );
        contentWindow.postMessage(
            {
                command: "setClipboardOptions",
                args: {
                    selectionCopyEnabled: terminalSelectionCopyEnabled,
                    rightClickAction: terminalRightClickAction,
                    middleClickPasteEnabled: terminalMiddleClickPasteEnabled,
                },
            },
            window.location.origin,
        );
    }, [
        terminalMiddleClickPasteEnabled,
        terminalRightClickAction,
        terminalSelectionCopyEnabled,
        terminalThemes,
        theme,
    ]);

    const syncTerminalActive = useCallback(() => {
        iframeRef.current?.contentWindow?.postMessage(
            { command: "setActive", args: active },
            window.location.origin,
        );
    }, [active]);

    useLayoutEffect(() => {
        syncTerminalActive();
    }, [syncTerminalActive]);

    const handleTerminalLoad = useCallback(() => {
        syncTerminal();
        syncTerminalActive();
        if (terminalHistoryChunksRef.current.length > 0) {
            iframeRef.current?.contentWindow?.postMessage(
                {
                    command: "restoreHistory",
                    args: `${terminalHistoryChunksRef.current.join("")}\r\n[Session history restored]\r\n`,
                },
                window.location.origin,
            );
        }

        const restoreCwd = cwd || initialCwd;
        if (restoreCwd) {
            const escapedCwd = restoreCwd.replace(/'/g, "'\\''");
            iframeRef.current?.contentWindow?.postMessage(
                { command: "input", args: `cd '${escapedCwd}'\n` },
                window.location.origin,
            );
        }

        if (active) {
            iframeRef.current?.contentWindow?.postMessage(
                { command: "focus" },
                window.location.origin,
            );
        }
    }, [active, cwd, initialCwd, syncTerminal, syncTerminalActive]);

    const reconnect = useCallback(() => {
        setConnectionStatus("connecting");
        setIframeKey((key) => key + 1);
    }, []);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            if (!iframeRef.current?.contentWindow) {
                return;
            }
            syncTerminal();
            if (!active) return;
            console.log("Terminal active", active);
            iframeRef.current.focus();
            iframeRef.current.contentWindow.focus();
            iframeRef.current.contentWindow.postMessage(
                { command: "focus" },
                window.location.origin,
            );
        }, 100);

        return () => window.clearTimeout(timeoutId);
    }, [active, syncTerminal]);

    return (
        <div className="terminalView">
            <div className="terminalToolbar">
                <Tooltip title={t("terminal_open_sftp")}>
                    <Button
                        disabled={cwd === undefined}
                        icon={<FolderOutlined />}
                        onClick={openSftp}
                        size="small"
                        type="text"
                    />
                </Tooltip>
                <Tooltip title={t("terminal_menu_clear")}>
                    <Button
                        aria-label={t("terminal_menu_clear")}
                        icon={<ClearOutlined />}
                        onClick={clearTerminal}
                        size="small"
                        type="text"
                    />
                </Tooltip>
            </div>
            <div
                className="terminalContainer"
                style={{ backgroundColor: terminalThemes[theme].background }}
            >
                <iframe
                    key={iframeKey}
                    ref={iframeRef}
                    src={url}
                    className="terminalIframe"
                    title="terminal"
                    onLoad={handleTerminalLoad}
                />
                {connectionStatus === "disconnected" && (
                    <div
                        className="terminalDisconnected"
                        role="alert"
                        style={{
                            backgroundColor: terminalThemes[theme].background,
                        }}
                    >
                        <div className="terminalDisconnectedTitle">
                            {t("terminal_disconnected")}
                        </div>
                        <Button
                            icon={<ReloadOutlined />}
                            onClick={reconnect}
                            type="primary"
                        >
                            {t("terminal_reconnect")}
                        </Button>
                    </div>
                )}
                {copyNotificationVisible && (
                    <div
                        className="terminalCopyNotification"
                        onMouseEnter={handleCopyNotificationMouseEnter}
                        onMouseLeave={handleCopyNotificationMouseLeave}
                        role="status"
                    >
                        <span>{t("terminal_copy_success")}</span>
                        <div className="terminalCopyNotificationActions">
                            <Tooltip title={t("app_btn_close")}>
                                <Button
                                    aria-label={t("app_btn_close")}
                                    icon={<CloseOutlined />}
                                    onClick={closeCopyNotification}
                                    size="small"
                                    type="text"
                                />
                            </Tooltip>
                            <Tooltip title={t("app_btn_never_tip")}>
                                <Button
                                    aria-label={t("app_btn_never_tip")}
                                    icon={<EyeInvisibleOutlined />}
                                    onClick={disableCopyNotification}
                                    size="small"
                                    type="text"
                                />
                            </Tooltip>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
