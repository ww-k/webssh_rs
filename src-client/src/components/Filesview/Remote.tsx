import { useMemoizedFn, useRequest } from "ahooks";
import { Spin } from "antd";
import { useEffect, useState } from "react";

import "./index.css";

import { postFavoriteDirectoryInitialize } from "@/api";
import { getSftpUserDirHome } from "@/api/sftp";
import { isSftpFileUri } from "@/helpers/file_uri";
import getSftpLsMapFiles from "@/helpers/getSftpLsMapFiles";
import useAppStore from "@/store";

import { isSearchUri } from "../Pathbar/search";
import FilesviewBase from "./Base";
import { handleDelete, handleRename } from "./remoteActions";
import handleContextmenu from "./remoteHandleContextmenu";

import type { IViewFileStat } from "@/types";

export default function FilesviewRemote({
    baseUrl,
    initialCwd,
    tabKey,
    targetId,
    showAllFiles = false,
}: {
    baseUrl: string;
    initialCwd?: string;
    tabKey: string;
    targetId: number;
    showAllFiles?: boolean;
}) {
    const [favoriteDirectoriesInitialized, setFavoriteDirectoriesInitialized] =
        useState(false);
    useEffect(() => {
        setFavoriteDirectoriesInitialized(false);
        let active = true;
        postFavoriteDirectoryInitialize(targetId)
            .catch(() => undefined)
            .finally(() => {
                if (active) setFavoriteDirectoriesInitialized(true);
            });
        return () => {
            active = false;
        };
    }, [targetId]);

    const { copyData, setCopyData, setTabState } = useAppStore();
    const [cwd, setCwd] = useState(
        initialCwd?.startsWith(baseUrl) ? initialCwd : "",
    );
    const [pathHistory, setPathHistory] = useState<string[]>([]);
    const [editingFile, setEditingFile] = useState<IViewFileStat>();

    const pushPathHistory = useMemoizedFn((newPath: string) => {
        setPathHistory((history) => {
            const index = history.indexOf(newPath);
            if (index === 0) {
                return history;
            } else if (index > 0) {
                history.splice(index, 1);
            }
            if (history.length >= 20) {
                history.length = 19;
            }
            return [newPath, ...history];
        });
    });
    const changeCwd = useMemoizedFn((uri: string) => {
        setCwd(uri);
        setTabState(tabKey, { cwd: uri });
        pushPathHistory(uri);
    });
    const setCwdUri = useMemoizedFn((pathOrUri: string) => {
        let uri = pathOrUri;
        if (!isSearchUri(pathOrUri) && !isSftpFileUri(pathOrUri)) {
            uri = `${baseUrl}${pathOrUri}`;
        }
        changeCwd(uri);
    });

    const {
        data: files = [],
        loading,
        runAsync: getCwdFiles,
    } = useRequest(
        async () => {
            if (isSearchUri(cwd)) {
                //TODO:
                return [];
            }
            return await getSftpLsMapFiles(cwd, showAllFiles);
        },
        {
            manual: true,
        },
    );

    // Re-fetch the current directory when the hidden-file visibility changes.
    // The base view already fetches when the path changes.
    // biome-ignore lint/correctness/useExhaustiveDependencies: only refresh when the toggle changes
    useEffect(() => {
        if (cwd) {
            void getCwdFiles();
        }
    }, [showAllFiles]);

    const getHome = useMemoizedFn(() => getSftpUserDirHome(targetId));
    const getDirs = useMemoizedFn(async (fileUrl: string) => {
        const files = await getSftpLsMapFiles(fileUrl);
        return files.filter((file) => file.isDir);
    });
    const onFileDoubleClick = useMemoizedFn((file: IViewFileStat) => {
        if (file.isDir) {
            changeCwd(file.uri);
        }
    });
    const onEnter = useMemoizedFn((file: IViewFileStat) => {
        if (file.isDir) {
            changeCwd(file.uri);
        }
    });
    const onDelete = useMemoizedFn((files: IViewFileStat[]) => {
        handleDelete(files, getCwdFiles);
    });
    const onRename = useMemoizedFn((file: IViewFileStat) => {
        handleRename(file, getCwdFiles);
    });

    if (!favoriteDirectoriesInitialized) {
        return (
            <div className="filesviewInitializing">
                <Spin />
            </div>
        );
    }

    return (
        <FilesviewBase
            cwd={cwd}
            history={pathHistory}
            files={files}
            loading={loading}
            posix={true}
            setCwd={setCwdUri}
            getDirs={getDirs}
            getHome={getHome}
            getCwdFiles={getCwdFiles}
            editingFile={editingFile}
            onCloseEditor={() => setEditingFile(undefined)}
            onContextMenu={(files, evt) => {
                handleContextmenu(files, evt, {
                    fileUri: cwd,
                    copyData,
                    getCwdFiles,
                    setCopyData,
                    onViewEdit: setEditingFile,
                });
            }}
            onFileDoubleClick={onFileDoubleClick}
            onEnter={onEnter}
            onDelete={onDelete}
            onRename={onRename}
        />
    );
}
