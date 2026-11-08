import {
    ClearOutlined,
    CloseOutlined,
    CopyOutlined,
    EyeInvisibleOutlined,
    FolderOutlined,
    ReloadOutlined,
    SnippetsOutlined,
    UploadOutlined,
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

import "@wterm/dom/css";
import "./index.css";

import { normalizeTerminalCwd } from "@/helpers/terminal_cwd";
import transferService from "@/services/transfer";
import useAppStore, { type ITab } from "@/store";

import popContextMenu from "../Contextmenu";
import renderFsSelector from "../FsSelector/render";
import {
    TerminalController,
    type TerminalControllerEvents,
} from "./controller";

import type { IContextmenuDataItem } from "../Contextmenu/typings";

function getTargetLabel(label: string, targetId?: number): string {
    const targetLabel = label.replace(/^ssh\s+/i, "").trim();
    return targetLabel || `target ${targetId ?? "unknown"}`;
}

function createWebMCPOptions(targetId: number | undefined, label: string) {
    const targetLabel = getTargetLabel(label, targetId);
    const slug = targetLabel
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const id = targetId === undefined ? "unknown" : targetId;

    return {
        name: `ssh-${slug || "terminal"}-${id}`,
        description: `SSH terminal for target "${targetLabel}" (target ID ${id}).`,
    };
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
    const [, setIframeKey] = useState(0);
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
    const terminalId = useMemo(() => `terminal-${tab.key}`, [tab.key]);
    const terminalControllerRef = useRef<TerminalController>();
    const terminalElementRef = useRef<HTMLDivElement>(null);
    const terminalEventsRef = useRef<TerminalControllerEvents>();
    const initialCwdRestoredRef = useRef(false);
    const terminalContextMenuDestroyRef = useRef<(() => void) | undefined>();
    const targetId = useMemo(() => {
        const match = tab.path.match(/^\/terminal\/(\d+)/);
        return match ? Number.parseInt(match[1], 10) : undefined;
    }, [tab.path]);
    const webmcpOptions = useMemo(
        () => createWebMCPOptions(targetId, tab.label),
        [tab.label, targetId],
    );

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

    const handleTerminalContextMenu = useCallback(
        (data: {
            x: number;
            y: number;
            hasSelection: boolean;
            selection: string;
        }) => {
            const postCommand = (command: string, args?: string) => {
                terminalControllerRef.current?.handleCommand(command, args);
            };
            const focusTerminal = () => postCommand("focus");
            const menus: IContextmenuDataItem[] = [
                {
                    label: t("files_menu_copy"),
                    disabled: !data.hasSelection || !data.selection,
                    click: () => {
                        if (!data.selection) return;
                        void navigator.clipboard
                            .writeText(data.selection)
                            .then(() => {
                                if (!showTerminalCopyNotification) return;
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
                data.x,
                data.y,
            ).destroy;
        },
        [scheduleCopyNotification, showTerminalCopyNotification, t],
    );

    terminalEventsRef.current = {
        onStatus: setConnectionStatus,
        onCwd: (value) => {
            const nextCwd = normalizeTerminalCwd(value);
            if (nextCwd) setCwd(nextCwd);
        },
        onCopy: () => {
            if (!showTerminalCopyNotification) return;
            setCopyNotificationVisible(true);
            copyNotificationRemainingRef.current = 2200;
            scheduleCopyNotification();
        },
        onInteraction: () => {
            terminalContextMenuDestroyRef.current?.();
            terminalContextMenuDestroyRef.current = undefined;
        },
        onContextMenu: handleTerminalContextMenu,
    };

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

    const uploadToCwd = useCallback(async () => {
        if (targetId === undefined || !cwd) return;

        let localPaths: string[];
        try {
            localPaths = await renderFsSelector({
                mode: "any",
                multiple: true,
                title: t("files_menu_select_upload_file"),
            });
        } catch {
            return;
        }

        if (localPaths.length === 0) return;
        await transferService.createUploadBatch({
            sources: localPaths,
            targetUri: `sftp:${targetId}:${cwd}`,
            all: false,
        });
    }, [cwd, t, targetId]);

    const clearTerminal = useCallback(() => {
        const controller = terminalControllerRef.current;
        if (!controller) return;
        controller.handleCommand("clear");
        controller.handleCommand("focus");
    }, []);

    const syncTerminal = useCallback(() => {
        const controller = terminalControllerRef.current;
        if (!controller) return;
        controller.handleCommand("setWebMCP", webmcpOptions);
        controller.handleCommand("setTheme", terminalThemes[theme]);
        controller.handleCommand("setClipboardOptions", {
            selectionCopyEnabled: terminalSelectionCopyEnabled,
            rightClickAction: terminalRightClickAction,
            middleClickPasteEnabled: terminalMiddleClickPasteEnabled,
        });
    }, [
        terminalMiddleClickPasteEnabled,
        terminalRightClickAction,
        terminalSelectionCopyEnabled,
        terminalThemes,
        webmcpOptions,
        theme,
    ]);

    const syncTerminalActive = useCallback(() => {
        terminalControllerRef.current?.handleCommand("setActive", active);
    }, [active]);

    useLayoutEffect(() => {
        syncTerminalActive();
    }, [syncTerminalActive]);

    const handleTerminalLoad = useCallback(() => {
        syncTerminal();
        syncTerminalActive();

        if (initialCwd && !initialCwdRestoredRef.current) {
            const escapedCwd = initialCwd.replace(/'/g, "'\\''");
            terminalControllerRef.current?.handleCommand(
                "input",
                `cd '${escapedCwd}'\n`,
            );
            initialCwdRestoredRef.current = true;
        }

        if (active) {
            terminalControllerRef.current?.handleCommand("focus");
        }
    }, [active, initialCwd, syncTerminal, syncTerminalActive]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: Keep one controller for each terminal id.
    useEffect(() => {
        if (targetId === undefined) return;
        if (terminalControllerRef.current) {
            return () => {
                if (terminalControllerRef.current) {
                    terminalControllerRef.current.destroy();
                    terminalControllerRef.current = undefined;
                }
            };
        };

        const controller = new TerminalController(terminalId, targetId, {
            onStatus: (status) => terminalEventsRef.current?.onStatus?.(status),
            onCwd: (cwd) => terminalEventsRef.current?.onCwd?.(cwd),
            onCopy: () => terminalEventsRef.current?.onCopy?.(),
            onInteraction: () =>
                terminalEventsRef.current?.onInteraction?.(),
            onContextMenu: (data) =>
                terminalEventsRef.current?.onContextMenu?.(data),
        }, terminalThemes[theme]);
        terminalControllerRef.current = controller;
        controller.init();
    }, [targetId, terminalId]);

    useEffect(() => {
        handleTerminalLoad();
    }, [handleTerminalLoad]);

    const reconnect = useCallback(() => {
        setConnectionStatus("connecting");
        setIframeKey((key) => key + 1);
    }, []);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            syncTerminal();
            if (!active) return;
            console.log("Terminal active", active);
            terminalControllerRef.current?.handleCommand("focus");
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
                <Tooltip title={t("files_menu_upload")}>
                    <Button
                        aria-label={t("files_menu_upload")}
                        disabled={cwd === undefined}
                        icon={<UploadOutlined />}
                        onClick={() => void uploadToCwd()}
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
                <div
                    id={terminalId}
                    ref={terminalElementRef}
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
