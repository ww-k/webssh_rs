import { confirm } from "@ui-sdk/react/alert-dialog";

import i18n from "@/i18n";

import filesConflictFilter from "./filesConflictFilter";

import type { IViewFileStat } from "@/types";

export default async function filesConflictConfirm<T = File | IViewFileStat>(
    files: T[],
    targetList: IViewFileStat[],
) {
    const noSame = filesConflictFilter<T>(files, targetList);
    const sameLen = files.length - noSame.length;
    if (sameLen === 0) return files;

    const overwrite = await confirm({
        title: i18n.t("files_conflict_content", { count: sameLen }),
        confirmLabel: i18n.t("files_conflict_overwrite"),
        cancelLabel: i18n.t("files_conflict_skip"),
    });
    return overwrite ? files : noSame;
}
