import { useMemoizedFn, useMount, useUpdateEffect } from "ahooks";
import { useMemo, useState } from "react";

import {
    downloadFile,
    downloadFileWithChunks,
    getSftpHome,
    getSftpLs,
} from "@/api/sftp";
import Pathbar from "@/components/Pathbar";
import { isSearchUri } from "@/components/Pathbar/search";

import "./Base.css";

import Filelist from "../Filelist";
import getColumns from "./getColumns";

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

export default function FilesviewBase({
    baseUrl,
    targetId,
    className,
    style,
}: {
    baseUrl: string;
    targetId: number;
    className?: string;
    style?: React.CSSProperties;
    [key: string]: unknown;
}) {
    const columns = useMemo(getColumns, []);
    const [cwd, setCwd] = useState("");
    const [files, setFiles] = useState<IFile[]>(mockFiles);
    const [selectedFiles, setSelectedFiles] = useState<IFile[]>([]);
    const searching = useMemo(() => isSearchUri(cwd), [cwd]);

    const refreshFileList = useMemoizedFn(async () => {
        const cwdUri = `${baseUrl}${cwd}`;
        const sftpFiles = await getSftpLs(cwdUri);
        const files: IFile[] = sftpFiles.map((item) => ({
            ...item,
            isDir: item.type === "d",
            uri: `${cwdUri}/${item.name}`,
            sortName: item.name.toLowerCase(),
        }));
        setFiles(files);
    });

    const handleFileDownload = useMemoizedFn(async (file: IFile) => {
        try {
            const chunkSize = 2 * 1024 * 1024; // 2MB分片
            let blob: Blob;

            if (file.size && file.size > chunkSize) {
                // 大文件使用分片下载
                blob = await downloadFileWithChunks(file.uri, chunkSize);
            } else {
                // 小文件直接下载
                blob = await downloadFile(file.uri);
            }

            // 创建下载链接
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = file.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Download failed:", error);
        }
    });

    const handleContextMenu = useMemoizedFn(
        (files: IFile[] | null, evt: MouseEvent | React.MouseEvent) => {
            if (!files || files.length === 0) return;

            // 这里可以添加右键菜单逻辑
            // 暂时直接触发下载
            if (files.length === 1 && files[0].type === "f") {
                handleFileDownload(files[0]);
            }
        },
    );

    useMount(async () => {
        const home = await getSftpHome(targetId);
        setCwd(home);
    });

    useUpdateEffect(() => {
        refreshFileList();
    }, [cwd]);

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
                onSelecteChange={setSelectedFiles}
                onContextMenu={handleContextMenu}
                onFileDoubleClick={(file) => {
                    if (file.type === "f") {
                        handleFileDownload(file);
                    }
                }}
            />
        </div>
    );
}
