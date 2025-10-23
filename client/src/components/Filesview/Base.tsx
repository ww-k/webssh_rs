import { useMemoizedFn } from "ahooks";
import { useEffect, useMemo } from "react";

import Pathbar, { type IQuickLink } from "@/components/Pathbar";
import { isSearchUri } from "@/components/Pathbar/search";

import "./Base.css";

import useAppStore from "@/store";

import Filelist from "../Filelist";
import { handlePaste } from "./remoteActions";

import type { IViewFileStat } from "@/types";

type IProps = {
    className?: string;
    style?: React.CSSProperties;
    files: IViewFileStat[];
    cwd: string;
    history?: string[];
    loading: boolean;
    posix?: boolean;
    setCwd: (cwd: string) => void;
    getHome: () => Promise<string>;
    getDirs?: (fileUrlOrPath: string) => Promise<IViewFileStat[]>;
    getQuickLinks?: () => Promise<IQuickLink[]>;
    getCwdFiles: () => Promise<unknown>;
    onSelecteChange?: (files: IViewFileStat[]) => void;
    onFileDoubleClick?: (file: IViewFileStat) => void;
    onContextMenu?: (
        files: IViewFileStat[] | null,
        evt: MouseEvent | React.MouseEvent,
    ) => void;
    onEnter?: (file: IViewFileStat) => void;
    onDelete?: (files: IViewFileStat[]) => void;
    onRename?: (file: IViewFileStat) => void;
};

export default function FilesviewBase({
    className,
    style,
    files,
    cwd,
    history,
    loading,
    posix,
    setCwd,
    getHome,
    getDirs,
    getQuickLinks,
    getCwdFiles,
    ...restProps
}: IProps) {
    const { copyData, setCopyData } = useAppStore();
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
    const onPaste = useMemoizedFn(async () => {
        if (!copyData) return;

        await handlePaste(copyData, cwd, getCwdFiles);
    });

    return (
        <div className={`filesviewBase ${className || ""}`} style={style}>
            <Pathbar
                className="filesviewBasePathbar"
                posix={posix}
                cwd={cwd}
                history={history}
                enableSearch={false}
                getDirs={getDirs}
                getQuickLinks={getQuickLinks}
                getCwdFiles={getCwdFiles}
                onChange={onPathChange}
            />
            <Filelist
                className="filesviewBaseFilelist"
                posix={posix}
                cwd={cwd}
                data={files}
                enableParentFile={!searching}
                loading={loading}
                onCopy={setCopyData}
                onPaste={onPaste}
                {...restProps}
            />
        </div>
    );
}
