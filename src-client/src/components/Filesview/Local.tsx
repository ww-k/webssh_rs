import { useMemoizedFn, useRequest } from "ahooks";
import { useState } from "react";

import { getFsUserDirDownload, getFsUserDirHome } from "@/api";
import getFsLsMapFiles, { normalizeLocalPath } from "@/helpers/getFsLsMapFiles";
import { isMSWindows } from "@/helpers/platform";

import FilesviewBase from "./Base";

import type { IViewFileStat } from "@/types";

export type LocalDefaultDirectory = "home" | "downloads";

export default function FilesviewLocal({
    className,
    style,
    initialCwd,
    defaultDirectory = "home",
    multiple,
    isFileSelectable,
    onCwdChange,
    onSelecteChange,
}: {
    className?: string;
    style?: React.CSSProperties;
    initialCwd?: string;
    defaultDirectory?: LocalDefaultDirectory;
    multiple?: boolean;
    isFileSelectable?: (file: IViewFileStat) => boolean;
    onCwdChange?: (cwd: string) => void;
    onSelecteChange?: (files: IViewFileStat[]) => void;
}) {
    const [cwd, setCwd] = useState(() => normalizeLocalPath(initialCwd || ""));
    const [pathHistory, setPathHistory] = useState<string[]>([]);

    const pushPathHistory = useMemoizedFn((newPath: string) => {
        setPathHistory((history) => {
            const index = history.indexOf(newPath);
            const nextHistory = [...history];
            if (index === 0) {
                return nextHistory;
            } else if (index > 0) {
                nextHistory.splice(index, 1);
            }
            if (nextHistory.length >= 20) {
                nextHistory.length = 19;
            }
            return [newPath, ...nextHistory];
        });
    });

    const setCwdPath = useMemoizedFn((path: string) => {
        const nextPath = normalizeLocalPath(path);
        setCwd(nextPath);
        pushPathHistory(nextPath);
        onCwdChange?.(nextPath);
        onSelecteChange?.([]);
    });

    const {
        data: files = [],
        loading,
        runAsync: getCwdFiles,
    } = useRequest(async () => await getFsLsMapFiles(cwd), {
        manual: true,
    });

    const getHome = useMemoizedFn(() =>
        defaultDirectory === "downloads"
            ? getFsUserDirDownload()
            : getFsUserDirHome(),
    );
    const getDirs = useMemoizedFn(async (path: string) => {
        const files = await getFsLsMapFiles(path);
        return files.filter((file) => file.isDir);
    });
    const onFileDoubleClick = useMemoizedFn((file: IViewFileStat) => {
        if (file.isDir) {
            setCwdPath(file.uri);
        }
    });
    const onEnter = useMemoizedFn((file: IViewFileStat) => {
        if (file.isDir) {
            setCwdPath(file.uri);
        }
    });

    return (
        <FilesviewBase
            className={className}
            style={style}
            cwd={cwd}
            history={pathHistory}
            files={files}
            loading={loading}
            posix={!isMSWindows}
            setCwd={setCwdPath}
            getDirs={getDirs}
            getHome={getHome}
            getCwdFiles={getCwdFiles}
            multiple={multiple}
            isFileSelectable={isFileSelectable}
            onSelecteChange={onSelecteChange}
            onFileDoubleClick={onFileDoubleClick}
            onEnter={onEnter}
        />
    );
}
