import { useMemo, useState } from "react";

import "./Base.css";

import { useMemoizedFn, useMount } from "ahooks";

import { getSftpLs } from "@/api/sftp";

import Filelist from "../Filelist";
import Pathbar from "../Pathbar";
import { isSearchUri } from "../Pathbar/search";
import getColumns from "./getColumns";

import type { IFile } from "@/types";

const mockFiles: IFile[] = [
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
];

export default function FilesviewBase({
    baseUrl,
    className,
    style,
}: {
    baseUrl: string;
    className?: string;
    style?: React.CSSProperties;
    [key: string]: unknown;
}) {
    const columns = useMemo(getColumns, []);
    const [cwd, setCwd] = useState("/Users/test/Downloads/dir1/dir2/file");
    const [files, setFiles] = useState<IFile[]>(mockFiles);
    const searching = useMemo(() => isSearchUri(cwd), [cwd]);

    const refreshFileList = useMemoizedFn(async () => {
        const sftpFiles = await getSftpLs(cwd);
        const files: IFile[] = sftpFiles.map((item) => ({
            ...item,
            isDir: item.type === "d",
            uri: `${baseUrl}/${cwd}/${item.name}`,
            sortName: item.name.toLowerCase(),
        }));
        setFiles(files);
    });

    useMount(refreshFileList);

    return (
        <div className="filesviewBase" style={style}>
            <Pathbar
                className="filesviewBasePathbar"
                posix={true}
                data={cwd}
                quickLinks={[]}
                history={[]}
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
                onChange={(newFileUrl) => {
                    console.debug("FilesviewBase: newFileUrl", newFileUrl);
                    // TODO: 更新history
                    // 获取文件列表
                    setCwd(newFileUrl);
                }}
            />
            <Filelist
                className="filesviewBaseFilelist"
                posix={true}
                columns={columns}
                fileUri={cwd}
                data={files}
                enableParentFile={!searching}
                loading={false}
            />
        </div>
    );
}
