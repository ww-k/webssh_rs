import { useMemoizedFn, useRequest } from "ahooks";
import { useState } from "react";

import "./index.css";

import { getSftpUserDirHome, getSftpUserDirs } from "@/api/sftp";
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
    targetId,
}: {
    baseUrl: string;
    targetId: number;
}) {
    const { copyData, setCopyData } = useAppStore();
    const [cwd, setCwd] = useState("");
    const [pathHistory, setPathHistory] = useState<string[]>([]);

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
    const setCwdUri = useMemoizedFn((pathOrUri: string) => {
        let uri = pathOrUri;
        if (!isSearchUri(pathOrUri) && !isSftpFileUri(pathOrUri)) {
            uri = `${baseUrl}${pathOrUri}`;
        }
        setCwd(uri);
        pushPathHistory(uri);
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
            return await getSftpLsMapFiles(cwd);
        },
        {
            manual: true,
        },
    );

    const getHome = useMemoizedFn(() => getSftpUserDirHome(targetId));
    const getDirs = useMemoizedFn(async (fileUrl: string) => {
        const files = await getSftpLsMapFiles(fileUrl);
        return files.filter((file) => file.isDir);
    });
    const getQuickLinks = useMemoizedFn(() => getSftpUserDirs(targetId));
    const onFileDoubleClick = useMemoizedFn((file: IViewFileStat) => {
        if (file.isDir) {
            setCwd(file.uri);
            pushPathHistory(file.uri);
        }
    });
    const onEnter = useMemoizedFn((file: IViewFileStat) => {
        if (file.isDir) {
            setCwd(file.uri);
            pushPathHistory(file.uri);
        }
    });
    const onDelete = useMemoizedFn((files: IViewFileStat[]) => {
        handleDelete(files, getCwdFiles);
    });
    const onRename = useMemoizedFn((file: IViewFileStat) => {
        handleRename(file, getCwdFiles);
    });

    return (
        <FilesviewBase
            cwd={cwd}
            history={pathHistory}
            files={files}
            loading={loading}
            posix={true}
            setCwd={setCwdUri}
            getDirs={getDirs}
            getQuickLinks={getQuickLinks}
            getHome={getHome}
            getCwdFiles={getCwdFiles}
            onContextMenu={(files, evt) => {
                handleContextmenu(files, evt, {
                    fileUri: cwd,
                    copyData,
                    getCwdFiles,
                    setCopyData,
                });
            }}
            onFileDoubleClick={onFileDoubleClick}
            onEnter={onEnter}
            onDelete={onDelete}
            onRename={onRename}
        />
    );
}
