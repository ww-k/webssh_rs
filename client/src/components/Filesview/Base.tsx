import { useMemoizedFn } from "ahooks";
import { useEffect, useMemo, useState } from "react";

import Pathbar, { type IQuickLink } from "@/components/Pathbar";
import { isSearchUri } from "@/components/Pathbar/search";

import "./Base.css";

import Filelist from "../Filelist";

import type { IFile } from "@/types";

export default function FilesviewBase({
    className,
    style,
    files,
    cwd,
    history,
    loading,
    setCwd,
    getHome,
    getDirs,
    getQuickLinks,
    getCwdFiles,
    onContextMenu,
    onSelecteChange,
    onFileDoubleClick,
    onEnter,
}: {
    className?: string;
    style?: React.CSSProperties;
    files: IFile[];
    cwd: string;
    history?: string[];
    loading: boolean;
    setCwd: (cwd: string) => void;
    getHome: () => Promise<string>;
    getDirs?: (fileUrlOrPath: string) => Promise<IFile[]>;
    getQuickLinks?: () => Promise<IQuickLink[]>;
    getCwdFiles: () => void;
    onSelecteChange?: (files: IFile[]) => void;
    onFileDoubleClick?: (file: IFile) => void;
    onContextMenu?: (
        files: IFile[] | null,
        evt: MouseEvent | React.MouseEvent,
    ) => void;
    onEnter?: (file: IFile) => void;
}) {
    const searching = useMemo(() => isSearchUri(cwd), [cwd]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: just init run
    useEffect(() => {
        getHome().then(setCwd);
    }, []);

    // biome-ignore lint/correctness/useExhaustiveDependencies: false
    useEffect(() => {
        getCwdFiles();
    }, [cwd]);

    const onPathChange = useMemoizedFn((newFileUrl: string) => {
        if (newFileUrl === cwd) {
            return;
        }
        console.debug("FilesviewBase: newFileUrl", newFileUrl);
        setCwd(newFileUrl);
    });

    return (
        <div className={`filesviewBase ${className || ""}`} style={style}>
            <Pathbar
                className="filesviewBasePathbar"
                posix={true}
                cwd={cwd}
                quickLinks={[]}
                history={history}
                enableSearch={false}
                getDirs={getDirs}
                getQuickLinks={getQuickLinks}
                getCwdFiles={getCwdFiles}
                onChange={onPathChange}
            />
            <Filelist
                className="filesviewBaseFilelist"
                posix={true}
                fileUri={cwd}
                data={files}
                enableParentFile={!searching}
                loading={loading}
                onSelecteChange={onSelecteChange}
                onFileDoubleClick={onFileDoubleClick}
                onContextMenu={onContextMenu}
                onEnter={onEnter}
            />
        </div>
    );
}
