import { Modal } from "antd";

import {
    postSftpCp,
    postSftpMkdir,
    postSftpRename,
    postSftpRm,
    postSftpRmRf,
} from "@/api";
import { getFilePath, parseSftpUri } from "@/helpers/file_uri";
import getSftpLsMapFiles from "@/helpers/getSftpLsMapFiles";
import { posix } from "@/helpers/path";
import renderPrompt from "@/helpers/renderPrompt";
import i18n from "@/i18n";

import renderBatchTaskProgressModal from "../BatchTaskProgressModal/render";
import filesConflictConfirm from "./filesConflictConfirm";
import generateCopyNewName from "./generateCopyNewName";

import type { IViewFileStat } from "@/types";
import type { IFileListCopyEvent } from "../Filelist/types";

type IGetCwdFiles = () => Promise<IViewFileStat[]>;

export async function handleDelete(
    files: IViewFileStat[],
    getCwdFiles: IGetCwdFiles,
) {
    async function deleteFile(file: IViewFileStat) {
        if (file.isDir) {
            await postSftpRmRf(file.uri);
        } else {
            await postSftpRm(file.uri);
        }
    }
    return new Promise<void>((resolve, reject) => {
        const modal = Modal.confirm({
            content: i18n.t("files_action_delete_content"),
            okText: i18n.t("app_btn_delete"),
            cancelText: i18n.t("app_btn_cancel"),
            okType: "danger",
            onOk: async () => {
                try {
                    if (files.length === 1) {
                        await deleteFile(files[0]);
                    } else {
                        modal.destroy();
                        await renderBatchTaskProgressModal<IViewFileStat>({
                            data: files,
                            action: (file) => deleteFile(file),
                            failsRender: () =>
                                i18n.t("files_action_batch_failed"),
                        });
                    }
                    await getCwdFiles();
                    resolve();
                } catch (err) {
                    reject(err);
                }
            },
            onCancel: reject,
        });
    });
}

export async function handleRename(
    file: IViewFileStat,
    getCwdFiles: IGetCwdFiles,
) {
    const newName = await renderPrompt({
        title: i18n.t("files_action_rename_file_prompt"),
        defaultValue: file.name,
        okText: i18n.t("app_btn_ok"),
        cancelText: i18n.t("app_btn_cancel"),
    });
    if (!newName) {
        return;
    }

    const filePath = getFilePath(file.uri);
    const newPath = posix.resolve(filePath, `../${newName}`);
    await postSftpRename(file.uri, newPath);
    await getCwdFiles();
}

export async function handleMkdir(fileUri: string, getCwdFiles: IGetCwdFiles) {
    const newName = await renderPrompt({
        title: i18n.t("files_action_rename_folder_prompt"),
        okText: i18n.t("app_btn_ok"),
        cancelText: i18n.t("app_btn_cancel"),
    });
    if (!newName) {
        return;
    }
    await postSftpMkdir(`${fileUri}/${newName}`);
    await getCwdFiles();
}

export async function handlePaste(
    copyData: IFileListCopyEvent,
    pasteTarget: string,
    getCwdFiles: IGetCwdFiles,
) {
    // TODO: copy from localhost, paste to target, upload files
    // TODO: copy from target, paste to localhost, download files
    // TODO: copy from target a, paste to target b, cross target transfer
    const copyUri = parseSftpUri(copyData.fileUri);
    const pasteUri = parseSftpUri(pasteTarget);
    if (!copyUri || !pasteUri) throw new Error("copyUri or pasteUri is null");
    if (copyUri.targetId !== pasteUri.targetId)
        throw new Error("targetId is not equal");

    switch (true) {
        case copyData.type === "copy" && copyUri.path === pasteUri.path: {
            const targetList = await getSftpLsMapFiles(pasteTarget);
            const generateCopyNewPath = (file: IViewFileStat) => {
                const newName = generateCopyNewName(targetList, file.name);
                return `${pasteUri.path}/${newName}`;
            };
            const files = copyData.files;
            if (files.length === 1) {
                await postSftpCp(files[0].uri, generateCopyNewPath(files[0]));
            } else {
                await renderBatchTaskProgressModal<IViewFileStat>({
                    data: files,
                    action: (file) => {
                        return postSftpCp(file.uri, generateCopyNewPath(file));
                    },
                    failsRender: () => i18n.t("files_action_batch_failed"),
                });
            }
            break;
        }
        case copyData.type === "copy" && copyUri.path !== pasteUri.path: {
            const targetList = await getSftpLsMapFiles(pasteTarget);
            const files = await filesConflictConfirm(
                copyData.files,
                targetList,
            );
            if (files.length === 1) {
                await postSftpCp(files[0].uri, pasteUri.path);
            } else {
                await renderBatchTaskProgressModal<IViewFileStat>({
                    data: files,
                    action: (file) => postSftpCp(file.uri, pasteUri.path),
                    failsRender: () => i18n.t("files_action_batch_failed"),
                });
            }
            break;
        }
        case copyData.type === "cut" && copyUri.path !== pasteUri.path: {
            const files = copyData.files;
            if (files.length === 1) {
                await postSftpRename(
                    files[0].uri,
                    `${pasteUri.path}/${files[0].name}`,
                );
            } else {
                await renderBatchTaskProgressModal<IViewFileStat>({
                    data: files,
                    action: (file) =>
                        postSftpRename(
                            file.uri,
                            `${pasteUri.path}/${file.name}`,
                        ),
                    failsRender: () => i18n.t("files_action_batch_failed"),
                });
            }
            break;
        }
        case copyData.type === "cut" && copyUri.path === pasteUri.path:
            // ignore
            return;
        default:
            throw new Error(`unsupported operation ${copyData.type}`);
    }

    await getCwdFiles();
}
