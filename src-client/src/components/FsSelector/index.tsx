import { Button, Modal, Space } from "antd";
import { useMemo, useState } from "react";

import FilesviewLocal from "../Filesview/Local";
import {
    getLastLocalDirectory,
    setLastLocalDirectory,
} from "./lastLocalDirectory";

import type { IViewFileStat } from "@/types";
import type { LocalDefaultDirectory } from "../Filesview/Local";

type FsSelectorMode = "file" | "directory";

function isDirectory(file: IViewFileStat) {
    return file.isDir;
}

export default function FsSelector({
    open,
    mode,
    multiple = false,
    defaultDirectory,
    title,
    onCancel,
    onOk,
}: {
    open: boolean;
    mode: FsSelectorMode;
    multiple?: boolean;
    defaultDirectory?: LocalDefaultDirectory;
    title: string;
    onCancel: () => void;
    onOk: (paths: string[]) => void;
}) {
    const [initialCwd] = useState(getLastLocalDirectory);
    const [cwd, setCwd] = useState(initialCwd || "/");
    const [selectedFiles, setSelectedFiles] = useState<IViewFileStat[]>([]);

    const canOk = useMemo(() => {
        if (mode === "directory") {
            return (
                selectedFiles.some((file) => file.isDir) ||
                (cwd !== "" && cwd !== "/")
            );
        }
        return selectedFiles.some((file) => !file.isDir);
    }, [cwd, mode, selectedFiles]);

    function handleOk() {
        if (mode === "directory") {
            const selectedDirectory = selectedFiles.find((file) => file.isDir);
            onOk([selectedDirectory?.uri || cwd]);
            return;
        }
        onOk(
            selectedFiles.filter((file) => !file.isDir).map((file) => file.uri),
        );
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
            <FilesviewLocal
                style={{ height: 420 }}
                initialCwd={initialCwd}
                defaultDirectory={defaultDirectory}
                multiple={multiple}
                isFileSelectable={
                    mode === "directory" ? isDirectory : undefined
                }
                onCwdChange={(cwd) => {
                    setCwd(cwd);
                    setLastLocalDirectory(cwd);
                    setSelectedFiles([]);
                }}
                onSelecteChange={(files) => {
                    const selectableFiles =
                        mode === "directory"
                            ? files.filter((file) => file.isDir)
                            : files;
                    const selected = multiple
                        ? selectableFiles
                        : selectableFiles.slice(-1);
                    setSelectedFiles(selected);
                }}
            />
        </Modal>
    );
}
