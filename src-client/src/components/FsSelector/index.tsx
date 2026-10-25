import { Button, Modal, Space } from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import useAppStore from "@/store";

import FilesviewLocal from "../Filesview/Local";

import type { IViewFileStat } from "@/types";
import type { LocalDefaultDirectory } from "../Filesview/Local";

type FsSelectorMode = "file" | "directory" | "any";

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
    const { t } = useTranslation();
    const lastLocalDirectory = useAppStore((state) => state.lastLocalDirectory);
    const setLastLocalDirectory = useAppStore(
        (state) => state.setLastLocalDirectory,
    );
    const [initialCwd] = useState(lastLocalDirectory);
    const [cwd, setCwd] = useState(initialCwd || "/");
    const [selectedFiles, setSelectedFiles] = useState<IViewFileStat[]>([]);

    const canOk = useMemo(() => {
        if (mode === "directory") {
            return (
                selectedFiles.some((file) => file.isDir) ||
                (cwd !== "" && cwd !== "/")
            );
        }
        return mode === "any"
            ? selectedFiles.length > 0
            : selectedFiles.some((file) => !file.isDir);
    }, [cwd, mode, selectedFiles]);

    function handleOk() {
        if (mode === "directory") {
            const selectedDirectory = selectedFiles.find((file) => file.isDir);
            onOk([selectedDirectory?.uri || cwd]);
            return;
        }
        onOk(
            (mode === "any"
                ? selectedFiles
                : selectedFiles.filter((file) => !file.isDir)
            ).map((file) => file.uri),
        );
    }

    return (
        <Modal
            open={open}
            title={title}
            width={800}
            centered
            onCancel={onCancel}
            footer={
                <Space>
                    <Button onClick={onCancel}>{t("app_btn_cancel")}</Button>
                    <Button type="primary" disabled={!canOk} onClick={handleOk}>
                        {t("app_btn_ok")}
                    </Button>
                </Space>
            }
        >
            <FilesviewLocal
                style={{ height: "min(420px, calc(100vh - 200px))" }}
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
                            ? files.filter(
                                  (file) => file.isDir && file.name !== "..",
                              )
                            : files.filter((file) => file.name !== "..");
                    const selected = multiple
                        ? selectableFiles
                        : selectableFiles.slice(-1);
                    setSelectedFiles(selected);
                }}
            />
        </Modal>
    );
}
