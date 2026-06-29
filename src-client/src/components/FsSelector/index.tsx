import { FolderOpenOutlined } from "@ant-design/icons";
import { Button, Modal, Space } from "antd";
import { useEffect, useMemo, useState } from "react";

import { getFsLs } from "@/api";
import { getParentDirUri } from "@/helpers/file_uri";

import Filelist from "../Filelist";

import type { IFsFileStat } from "@/api";
import type { IViewFileStat } from "@/types";

type FsSelectorMode = "file" | "directory";

export default function FsSelector({
    open,
    mode,
    multiple,
    title,
    onCancel,
    onOk,
}: {
    open: boolean;
    mode: FsSelectorMode;
    multiple?: boolean;
    title: string;
    onCancel: () => void;
    onOk: (paths: string[]) => void;
}) {
    const [cwd, setCwd] = useState("/");
    const [files, setFiles] = useState<IViewFileStat[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedFiles, setSelectedFiles] = useState<IViewFileStat[]>([]);

    const canOk = useMemo(() => {
        if (mode === "directory") return cwd !== "" && cwd !== "/";
        return selectedFiles.some((file) => !file.isDir);
    }, [cwd, mode, selectedFiles]);

    useEffect(() => {
        if (open) {
            loadFiles("/");
        }
    }, [open]);

    async function loadFiles(path: string) {
        setLoading(true);
        try {
            const fsFiles = await getFsLs(path);
            setFiles(fsFiles.map(toViewFile));
            setCwd(path);
            setSelectedFiles([]);
        } finally {
            setLoading(false);
        }
    }

    function handleOk() {
        if (mode === "directory") {
            onOk([cwd]);
            return;
        }
        onOk(selectedFiles.filter((file) => !file.isDir).map((file) => file.uri));
    }

    function enterParent() {
        if (cwd === "/") return;
        const parent = getParentPath(cwd);
        loadFiles(parent);
    }

    return (
        <Modal
            open={open}
            title={title}
            width={860}
            onCancel={onCancel}
            footer={
                <Space>
                    <Button onClick={onCancel}>取消</Button>
                    <Button type="primary" disabled={!canOk} onClick={handleOk}>
                        确定
                    </Button>
                </Space>
            }
        >
            <Space style={{ marginBottom: 8 }}>
                <Button
                    icon={<FolderOpenOutlined />}
                    onClick={() => loadFiles("/")}
                >
                    根目录
                </Button>
                <Button disabled={cwd === "/"} onClick={enterParent}>
                    上级
                </Button>
                <span>{cwd}</span>
            </Space>
            <div style={{ height: 420 }}>
                <Filelist
                    cwd={cwd}
                    data={files}
                    loading={loading}
                    posix={true}
                    enableParentFile={false}
                    onSelecteChange={(files) => {
                        setSelectedFiles(multiple ? files : files.slice(0, 1));
                    }}
                    onFileDoubleClick={(file) => {
                        if (file.isDir) {
                            loadFiles(file.uri);
                        }
                    }}
                    onEnter={(file) => {
                        if (file.isDir) {
                            loadFiles(file.uri);
                        }
                    }}
                />
            </div>
        </Modal>
    );
}

function toViewFile(file: IFsFileStat): IViewFileStat {
    return {
        name: file.name,
        type: file.type,
        size: file.size || 0,
        atime: file.atime || 0,
        mtime: file.mtime || 0,
        permissions: file.permissions,
        uri: file.path,
        sortName: file.name.toLowerCase(),
        isDir: file.type === "d",
    };
}

function getParentPath(path: string) {
    if (path === "/") return "/";
    return getParentDirUri(path) || "/";
}
