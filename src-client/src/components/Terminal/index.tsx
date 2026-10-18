import { FolderOpenOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import "./index.css";

import { normalizeTerminalCwd } from "@/helpers/terminal_cwd";
import useAppStore, { type ITab } from "@/store";

const terminalMessageType = "webssh:terminal-cwd";

export default function Terminal({
    active,
    tab,
}: {
    active: boolean;
    tab: ITab;
}) {
    const { t } = useTranslation();
    const openSftpAt = useAppStore((state) => state.openSftpAt);
    const [cwd, setCwd] = useState<string>();
    const url = useMemo(
        () => tab.path.replace("/terminal/", "terminal.html?target_id="),
        [tab.path],
    );
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const targetId = useMemo(() => {
        const match = tab.path.match(/^\/terminal\/(\d+)/);
        return match ? Number.parseInt(match[1], 10) : undefined;
    }, [tab.path]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (
                event.origin !== window.location.origin ||
                event.source !== iframeRef.current?.contentWindow
            ) {
                return;
            }

            const data = event.data;
            if (
                !data ||
                data.type !== terminalMessageType ||
                data.targetId !== targetId ||
                typeof data.cwd !== "string"
            ) {
                return;
            }

            const nextCwd = normalizeTerminalCwd(data.cwd);
            if (nextCwd) setCwd(nextCwd);
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [targetId]);

    const openSftp = useCallback(() => {
        if (targetId === undefined || !cwd) return;
        openSftpAt(targetId, cwd, tab.key);
    }, [cwd, openSftpAt, tab.key, targetId]);

    useEffect(() => {
        setTimeout(() => {
            if (!(active && iframeRef.current?.contentWindow)) {
                return;
            }
            console.log("Terminal active", active);
            iframeRef.current.focus();
            iframeRef.current.contentWindow.focus();
            iframeRef.current.contentWindow.postMessage(
                { command: "focus" },
                window.location.origin,
            );
        }, 100);
    }, [active]);

    return (
        <div className="terminalView">
            <div className="terminalToolbar">
                {cwd && targetId !== undefined && (
                    <Button
                        icon={<FolderOpenOutlined />}
                        onClick={openSftp}
                        size="small"
                        title={t("terminal_open_sftp")}
                        type="text"
                    >
                        {t("terminal_open_sftp")}
                    </Button>
                )}
            </div>
            <iframe
                ref={iframeRef}
                src={url}
                className="terminalIframe"
                title="terminal"
            />
        </div>
    );
}
