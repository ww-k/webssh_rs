import { Modal } from "antd";

import { postSftpMkdir, postSftpRename, postSftpRm, postSftpRmRf } from "@/api";
import { getFilePath, parseSftpUri } from "@/helpers/file_uri";
import { posix } from "@/helpers/path";

import renderBatchTaskProgressModal from "../BatchTaskProgressModal/render";

import type { IFile } from "@/types";
import type { IFileListCopyEvent } from "../Filelist/types";

type IGetCwdFiles = () => Promise<IFile[]>;

export async function handleDelete(files: IFile[], getCwdFiles: IGetCwdFiles) {
    async function deleteFile(file: IFile) {
        if (file.isDir) {
            await postSftpRmRf(file.uri);
        } else {
            await postSftpRm(file.uri);
        }
    }
    return new Promise<void>((resolve, reject) => {
        Modal.confirm({
            content: "删除后将不可恢复，确认删除吗?",
            okText: "删除",
            cancelText: "取消",
            okType: "danger",
            onOk: async () => {
                try {
                    if (files.length === 1) {
                        await deleteFile(files[0]);
                    } else {
                        await renderBatchTaskProgressModal<IFile>({
                            data: files,
                            action: (file) => deleteFile(file),
                            failsRender: () => "批量操作失败",
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

export async function handleRename(file: IFile, getCwdFiles: IGetCwdFiles) {
    const newName = window.prompt("请输入文件名", file.name);
    if (!newName) {
        return;
    }

    const filePath = getFilePath(file.uri);
    const newPath = posix.resolve(filePath, `../${newName}`);
    await postSftpRename(file.uri, newPath);
    await getCwdFiles();
}

export async function handleMkdir(fileUri: string, getCwdFiles: IGetCwdFiles) {
    const newName = window.prompt("请输入文件夹名", "");
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
        case copyData.type === "copy" && copyUri.path === pasteUri.path:
            //TODO: same directory, copy a new file name
            break;
        case copyData.type === "copy" && copyUri.path !== pasteUri.path:
            //TODO: copy to another directory
            break;
        case copyData.type === "cut" && copyUri.path !== pasteUri.path: {
            if (copyData.files.length === 1) {
                await postSftpRename(
                    copyData.files[0].uri,
                    `${pasteUri.path}/${copyData.files[0].name}`,
                );
            } else {
                await renderBatchTaskProgressModal<IFile>({
                    data: copyData.files,
                    action: (file) =>
                        postSftpRename(
                            file.uri,
                            `${pasteUri.path}/${file.name}`,
                        ),
                    failsRender: () => "批量操作失败",
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
