import { useMemoizedFn, useRequest } from "ahooks";
import { useState } from "react";

import { getFsHome, getFsLs } from "@/api";
import { getFilePath } from "@/helpers/file_uri";
import { posix, win32 } from "@/helpers/path";
import { isMSWindows } from "@/helpers/platform";

import FilesviewBase from "./Base";

import type { IFsFileStat } from "@/api";
import type { IViewFileStat } from "@/types";

export default function FilesviewLocal({
    className,
    style,
    onCwdChange,
    onSelecteChange,
}: {
    className?: string;
    style?: React.CSSProperties;
    onCwdChange?: (cwd: string) => void;
    onSelecteChange?: (files: IViewFileStat[]) => void;
}) {
    const [cwd, setCwd] = useState("/");
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
    } = useRequest(
        async () => getFsLs(cwd).then((files) => mapFsFiles(files, cwd)),
        {
            manual: true,
        },
    );

    const getHome = useMemoizedFn(() => getFsHome());
    const getDirs = useMemoizedFn(async (path: string) => {
        const files = await getFsLs(normalizeLocalPath(getFilePath(path)));
        return mapFsFiles(files, path).filter((file) => file.isDir);
    });
    const getQuickLinks = useMemoizedFn(async () => [
        {
            name: "/",
            path: "/",
        },
    ]);
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
            getQuickLinks={getQuickLinks}
            getHome={getHome}
            getCwdFiles={getCwdFiles}
            onSelecteChange={onSelecteChange}
            onFileDoubleClick={onFileDoubleClick}
            onEnter={onEnter}
        />
    );
}

function mapFsFiles(files: IFsFileStat[], cwd: string) {
    return files.map((file) => toViewFile(file, cwd));
}

function normalizeLocalPath(path: string) {
    if (isMSWindows && /^[a-zA-Z]:$/.test(path)) {
        return `${path}\\`;
    }
    return path;
}

function toViewFile(file: IFsFileStat, cwd: string): IViewFileStat {
    const uri = joinLocalPath(cwd, file.name);
    return {
        name: file.name,
        type: file.type,
        size: file.size || 0,
        atime: file.atime || 0,
        mtime: file.mtime || 0,
        permissions: file.permissions,
        uri,
        sortName: file.name.toLowerCase(),
        isDir: file.type === "d",
    };
}

function joinLocalPath(parent: string, name: string) {
    if (isMSWindows) {
        const parentPath = getFilePath(parent);
        if (parentPath === "/") {
            return normalizeLocalPath(name);
        }
        return normalizeLocalPath(win32.join(parentPath, name));
    }
    return posix.join(getFilePath(parent), name);
}
