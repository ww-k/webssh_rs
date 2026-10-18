import { Modal } from "antd";

import i18n from "@/i18n";

import filesConflictFilter from "./filesConflictFilter";

import type { IViewFileStat } from "@/types";

export default function filesConflictConfirm<T = File | IViewFileStat>(
    files: T[],
    targetList: IViewFileStat[],
) {
    return new Promise<T[]>((resolve) => {
        const noSame = filesConflictFilter<T>(files, targetList);
        const sameLen = files.length - noSame.length;

        if (sameLen > 0) {
            Modal.confirm({
                content: i18n.t("files_conflict_content", { count: sameLen }),
                okText: i18n.t("files_conflict_overwrite"),
                cancelText: i18n.t("files_conflict_skip"),
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
