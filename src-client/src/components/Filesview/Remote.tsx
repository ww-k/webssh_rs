import { useMemoizedFn, useRequest } from "ahooks";
import { useState } from "react";

import "./index.css";

import { getSftpHome } from "@/api/sftp";
import { isSftpFileUri } from "@/helpers/file_uri";
import getSftpLsMapFiles from "@/helpers/getSftpLsMapFiles";
import useAppStore from "@/store";

import { isSearchUri } from "../Pathbar/search";
import FilesviewBase from "./Base";
import { handleDelete, handleRename } from "./remoteActions";
import handleContextmenu from "./remoteHandleContextmenu";

import type { IViewFileStat } from "@/types";

const mockFiles: IViewFileStat[] = import.meta.env.DEV
    ? [
          {
              name: "file1.txt",
              type: "f",
              size: 1024,
              atime: 1638400000,
              mtime: 1638400000,
              permissions: "rw-r--r--",
              uri: "sftp:1:/Users/test/Downloads/file1.txt",
              sortName: "file1.txt",
              isDir: false,
          },
          {
              name: "file2.txt",
              type: "f",
              size: 2048,
              atime: 1638400000,
              mtime: 1638400000,
              permissions: "rw-r--r--",
              uri: "sftp:1:/Users/test/Downloads/file2.txt",
              sortName: "file2.txt",
              isDir: false,
          },
          {
              name: "dir1",
              type: "d",
              size: 2048,
              atime: 1638400000,
              mtime: 1638400000,
              permissions: "rw-r--r--",
              uri: "sftp:1:/Users/test/Downloads/dir1",
              sortName: "dir1",
              isDir: true,
          },
          {
              name: "dir2",
              type: "d",
              size: 2048,
              atime: 1638400000,
              mtime: 1638400000,
              permissions: "rw-r--r--",
              uri: "sftp:1:/Users/test/Downloads/dir2",
              sortName: "dir2",
              isDir: true,
          },
      ]
    : [];

const mockCwd = import.meta.env.DEV ? "sftp:1:/Users/test/Downloads" : "";

export default function FilesviewRemote({
    baseUrl,
    targetId,
}: {
    baseUrl: string;
    targetId: number;
}) {
    const { copyData, setCopyData } = useAppStore();
    const [cwd, setCwd] = useState(mockCwd);
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
        data: files = mockFiles,
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

    const getHome = useMemoizedFn(() => getSftpHome(targetId));
    const getDirs = useMemoizedFn(async (fileUrl: string) => {
        const files = await getSftpLsMapFiles(fileUrl);
        return files.filter((file) => file.isDir);
    });
    const getQuickLinks = useMemoizedFn(async () => {
        // TODO:
        return [
            {
                name: "/",
                path: "/",
            },
            {
                name: "Home",
                path: "/Users/test",
            },
            {
                name: "Desktop",
                path: "/Users/test/Desktop",
            },
            {
                name: "Documents",
                path: "/Users/test/Documents",
            },
            {
                name: "Downloads",
                path: "/Users/test/Downloads",
            },
        ];
    });
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
        <div className="filesview">
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
        </div>
    );
}
