import { useEffect, useMemo, useRef } from "react";

import "./index.css";

import type { ITab } from "@/store";
export default function Terminal({
    active,
    tab,
}: {
    active: boolean;
    tab: ITab;
}) {
    const url = useMemo(
        () => tab.path.replace("/terminal/", "terminal.html?target_id="),
        [tab.path],
    );
    const iframeRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        setTimeout(() => {
            if (
                !(
                    active &&
                    iframeRef.current &&
                    iframeRef.current.contentWindow
                )
            ) {
                return;
            }
            console.log("Terminal active", active);
            iframeRef.current.focus();
            iframeRef.current.contentWindow.focus();
            iframeRef.current.contentWindow.postMessage(
                { command: "focus" },
                "*",
            );
        }, 100);
    }, [active]);

    return (
        <iframe
            ref={iframeRef}
            src={url}
            className="terminalIframe"
            title="terminal"
        />
    );
}
