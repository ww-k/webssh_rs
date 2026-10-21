import { CodeOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import "./index.css";

import { getFilePath, isSftpFileUri } from "@/helpers/file_uri";
import useAppStore from "@/store";

import FilesviewRemote from "./Remote";

import type { ITab } from "@/store";

export default function Filesview({
    tab,
}: {
    tab: ITab;
    [key: string]: unknown;
}) {
    const { t } = useTranslation();
    const openTerminalAt = useAppStore((state) => state.openTerminalAt);
    const { baseUrl, targetId } = useMemo(() => {
        // 从路径中解析 target ID: /filesview/123 -> targetId: 123
        const match = tab.path.match(/\/filesview\/(\d+)/);
        const targetId = match ? parseInt(match[1], 10) : null;
        const baseUrl = `sftp:${targetId}:`;

        return { baseUrl, targetId };
    }, [tab.path]);
    const cwd = useMemo(() => {
        const value = tab.state?.cwd;
        if (typeof value !== "string" || !isSftpFileUri(value)) {
            return undefined;
        }
        return getFilePath(value);
    }, [tab.state?.cwd]);

    if (!targetId) {
        return <div>missing targetId</div>;
    }

    return (
        <div className="filesview">
            <div className="filesviewToolbar">
                <Tooltip title={t("filesview_open_terminal")}>
                    <Button
                        aria-label={t("filesview_open_terminal")}
                        disabled={!cwd}
                        icon={<CodeOutlined />}
                        onClick={() => {
                            if (targetId !== null) {
                                openTerminalAt(targetId, cwd, tab.key);
                            }
                        }}
                        size="small"
                        type="text"
                    />
                </Tooltip>
            </div>
            <FilesviewRemote
                baseUrl={baseUrl}
                initialCwd={
                    typeof tab.state?.cwd === "string"
                        ? tab.state.cwd
                        : undefined
                }
                tabKey={tab.key}
                targetId={targetId}
            />
        </div>
    );
}
