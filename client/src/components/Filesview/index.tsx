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
    const { baseUrl, targetId } = useMemo(() => {
        // 从路径中解析 target ID: /filesview/123 -> targetId: 123
        const match = tab.path.match(/\/filesview\/(\d+)/);
        const targetId = match ? parseInt(match[1], 10) : null;
        const baseUrl = `sftp:${targetId}:`;

        return { baseUrl, targetId };
    }, [tab.path]);

    if (!targetId) {
        return <div>missing targetId</div>;
    }

    return (
        <div className="filesview">
            <FilesviewBase
                baseUrl={baseUrl}
                targetId={targetId}
                active={active}
            />
        </div>
    );
}
