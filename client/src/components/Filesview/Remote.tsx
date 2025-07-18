import { useMemo, useState } from "react";

import "./index.css";

import { useMemoizedFn } from "ahooks";

import { getSftpHome, getSftpLs } from "@/api/sftp";
import { getDirPath } from "@/helpers/file_uri";

import { isSearchUri } from "../Pathbar/search";
import FilesviewBase from "./Base";
import handleContextmenu from "./remoteHandleContextmenu";

import type { IFile } from "@/types";

const mockFiles: IFile[] = import.meta.env.DEV
    ? [
          {
              name: "file1.txt",
              type: "f",
              size: 1024,
              atime: 1638400000000,
              mtime: 1638400000000,
              permissions: "rw-r--r--",
              uri: "sftp:1:/Users/test/Downloads/file1.txt",
              sortName: "file1.txt",
              isDir: false,
          },
          {
              name: "file2.txt",
              type: "f",
              size: 2048,
              atime: 1638400000000,
              mtime: 1638400000000,
              permissions: "rw-r--r--",
              uri: "sftp:1:/Users/test/Downloads/file2.txt",
              sortName: "file2.txt",
              isDir: false,
          },
          {
              name: "dir1",
              type: "d",
              size: 2048,
              atime: 1638400000000,
              mtime: 1638400000000,
              permissions: "rw-r--r--",
              uri: "sftp:1:/Users/test/Downloads/dir1",
              sortName: "dir1",
              isDir: true,
          },
          {
              name: "dir2",
              type: "d",
              size: 2048,
              atime: 1638400000000,
              mtime: 1638400000000,
              permissions: "rw-r--r--",
              uri: "sftp:1:/Users/test/Downloads/dir2",
              sortName: "dir2",
              isDir: true,
          },
      ]
    : [];

const mockCwd = import.meta.env.DEV ? "/Users/test/Downloads" : "";

export default function FilesviewRemote({
    baseUrl,
    targetId,
}: {
    baseUrl: string;
    targetId: number;
}) {
    const [cwd, setCwd] = useState(mockCwd);
    const cwdUri = useMemo(() => `${baseUrl}${cwd}`, [baseUrl, cwd]);
    const [files, setFiles] = useState<IFile[]>(mockFiles);

    const getCwdFiles = useMemoizedFn(async () => {
        if (isSearchUri(cwdUri)) {
            //TODO:
            return;
        }
        const sftpFiles = await getSftpLs(cwdUri);
        const files: IFile[] = sftpFiles.map((item) => ({
            ...item,
            isDir: item.type === "d",
            uri: `${cwdUri}/${item.name}`,
            sortName: item.name.toLowerCase(),
        }));
        setFiles(files);
    });
    const getHome = useMemoizedFn(() => getSftpHome(targetId));
    const onFileDoubleClick = useMemoizedFn((file: IFile) => {
        if (file.isDir) {
            setCwd(getDirPath(file.uri));
        }
    });

    return (
        <div className="filesview">
            <FilesviewBase
                cwd={cwd}
                cwdUri={cwdUri}
                files={files}
                targetId={targetId}
                getDirs={(fileUrl) => {
                    console.debug("FilesviewBase: getDirs", fileUrl);
                    return new Promise((resolve) => {
                        setTimeout(() => {
                            resolve(
                                mockFiles.filter((item) => item.type === "d"),
                            );
                        }, 1000);
                    });
                }}
                getQuickLinks={async () => {
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
                }}
                setCwd={setCwd}
                getHome={getHome}
                getCwdFiles={getCwdFiles}
                onContextMenu={(files, evt) => {
                    handleContextmenu(files, evt, {
                        fileUri: cwdUri,
                    });
                }}
                onFileDoubleClick={onFileDoubleClick}
            />
        </div>
    );
}
