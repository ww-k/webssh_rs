import { useMemo } from "react";

import "./index.css";

import FilesviewBase from "./Base";

import type { ITab } from "@/store";

export default function Filesview({
    active,
    tab,
}: {
    active: boolean;
    tab: ITab;
    [key: string]: unknown;
}) {
    const baseUrl = useMemo(
        () => tab.path.replace("/filesview/", "sftp:"),
        [tab.path],
    );

    return (
        <div className="filesview">
            <FilesviewBase baseUrl={baseUrl} />
        </div>
    );
}
