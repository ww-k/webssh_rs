import { Button, Modal, Space } from "antd";
import { useMemo, useState } from "react";

import FilesviewLocal from "../Filesview/Local";

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
    const [selectedFiles, setSelectedFiles] = useState<IViewFileStat[]>([]);

    const canOk = useMemo(() => {
        if (mode === "directory") return cwd !== "" && cwd !== "/";
        return selectedFiles.some((file) => !file.isDir);
    }, [cwd, mode, selectedFiles]);

    function handleOk() {
        if (mode === "directory") {
            onOk([cwd]);
            return;
        }
        onOk(selectedFiles.filter((file) => !file.isDir).map((file) => file.uri));
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
                onCwdChange={(cwd) => {
                    setCwd(cwd);
                    setSelectedFiles([]);
                }}
                onSelecteChange={(files) => {
                    const selected = multiple ? files : files.slice(0, 1);
                    setSelectedFiles(selected);
                }}
            />
        </Modal>
    );
}
