import { Modal } from "antd";

import filesConflictFilter from "./files_conflict_filter";

import type { IFile } from "@/types";

export default function filesConflictConfirm<T = File | IFile>(
    files: T[],
    targetList: IFile[],
) {
    return new Promise<T[]>((resolve) => {
        const noSame = filesConflictFilter<T>(files, targetList);
        const sameLen = files.length - noSame.length;

        if (sameLen > 0) {
            Modal.confirm({
                content: "目标包含 s% 个同名文件，是否覆盖或跳过?".replace(
                    "s%",
                    `${sameLen}`,
                ),
                okText: "覆盖",
                cancelText: "跳过",
                onOk() {
                    return resolve(files);
                },
                onCancel() {
                    return resolve(noSame);
                },
            });
        } else {
            return resolve(files);
        }
    });
}
