import { useMemo } from "react";

import "./index.css";

import type { ITab } from "@/store";
export default function Terminal({ tab }: { tab: ITab }) {
    const url = useMemo(() => tab.path.replace("/terminal/", "terminal.html?connect_id="), [tab.path]);
    return <iframe src={url} className="terminalIframe" />;
}
