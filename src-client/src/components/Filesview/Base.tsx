import { useMemoizedFn } from "ahooks";
import { Spin } from "antd";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import Pathbar from "@/components/Pathbar";
import { isSearchUri } from "@/components/Pathbar/search";

import "./Base.css";

import useAppStore from "@/store";

import Filelist from "../Filelist";
import FileEditorPanel from "./FileEditorPanel";
import { handlePaste } from "./remoteActions";

import type { IViewFileStat } from "@/types";
import type { IFileListDragDropEvent } from "../Filelist/types";

type IProps = {
    className?: string;
    style?: React.CSSProperties;
    files: IViewFileStat[];
    cwd: string;
    history?: string[];
    loading: boolean;
    loadError?: boolean;
    posix?: boolean;
    setCwd: (cwd: string) => void;
    getHome: () => Promise<string>;
    getDirs?: (fileUrlOrPath: string) => Promise<IViewFileStat[]>;
    getCwdFiles: () => Promise<IViewFileStat[]>;
    multiple?: boolean;
    enableDragFromOS?: boolean;
    isFileSelectable?: (file: IViewFileStat) => boolean;
    onSelecteChange?: (files: IViewFileStat[]) => void;
    onFileDoubleClick?: (file: IViewFileStat) => void;
    onContextMenu?: (
        files: IViewFileStat[] | null,
        evt: MouseEvent | React.MouseEvent,
    ) => void;
    onEnter?: (file: IViewFileStat) => void;
    onDelete?: (files: IViewFileStat[]) => void;
    onRename?: (file: IViewFileStat) => void;
    onDrop?: (evt: IFileListDragDropEvent) => void;
    editingFile?: IViewFileStat;
    onCloseEditor?: () => void;
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
    getCwdFiles,
    loadError = false,
    editingFile,
    onCloseEditor,
    ...restProps
}: IProps) {
    const { t } = useTranslation();
    const copyData = useAppStore((state) => state.copyData);
    const setCopyData = useAppStore((state) => state.setCopyData);
    const searching = useMemo(() => isSearchUri(cwd), [cwd]);
    const homeRequested = useRef(false);
    const loadedCwd = useRef<string>();

    // biome-ignore lint/correctness/useExhaustiveDependencies: just init run
    useEffect(() => {
        if (cwd) return;
        if (homeRequested.current) return;
        homeRequested.current = true;
        void getHome()
            .then(setCwd)
            .catch(() => {
                homeRequested.current = false;
            });
    }, []);

    // biome-ignore lint/correctness/useExhaustiveDependencies: false
    useEffect(() => {
        if (!cwd) return;
        if (loadedCwd.current === cwd) return;
        loadedCwd.current = cwd;
        void getCwdFiles().catch(() => undefined);
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
            {cwd && (
                <Pathbar
                    className="filesviewBasePathbar"
                    posix={posix}
                    cwd={cwd}
                    history={history}
                    enableSearch={false}
                    getDirs={getDirs}
                    getCwdFiles={getCwdFiles}
                    onChange={onPathChange}
                />
            )}
            <div className="filesviewBaseContent">
                <Filelist
                    className="filesviewBaseFilelist"
                    posix={posix}
                    cwd={cwd}
                    data={files}
                    enableParentFile={!searching}
                    loading={loading}
                    emptyContent={
                        loadError ? (
                            <button
                                className="filesviewFilelistRetry"
                                onClick={() => {
                                    void getCwdFiles().catch(() => undefined);
                                }}
                                type="button"
                            >
                                {t("filesview_load_failed_retry")}
                            </button>
                        ) : undefined
                    }
                    onCopy={setCopyData}
                    onPaste={onPaste}
                    {...restProps}
                />
                {editingFile && onCloseEditor && (
                    <FileEditorPanel
                        file={editingFile}
                        onClose={onCloseEditor}
                    />
                )}
            </div>
            {loading && (
                <div className="filesviewBaseLoadLayer">
                    <Spin spinning={loading} />
                </div>
            )}
        </div>
    );
}
