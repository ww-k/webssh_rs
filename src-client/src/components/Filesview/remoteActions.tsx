import { DownOutlined } from "@ant-design/icons";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import CodeMirror from "@uiw/react-codemirror";
import { Button, Dropdown, Modal, Space, Spin } from "antd";
import { forwardRef, useImperativeHandle, useState } from "react";

import {
    getSftpDownload,
    postFsOpen,
    postSftpCp,
    postSftpMkdir,
    postSftpRename,
    postSftpRm,
    postSftpRmRf,
    postSftpUpload,
} from "@/api";
import { getFilePath, parseSftpUri } from "@/helpers/file_uri";
import getSftpLsMapFiles from "@/helpers/getSftpLsMapFiles";
import { posix } from "@/helpers/path";

import renderBatchTaskProgressModal from "../BatchTaskProgressModal/render";
import filesConflictConfirm from "./filesConflictConfirm";
import generateCopyNewName from "./generateCopyNewName";

import type { Extension } from "@codemirror/state";
import type { IViewFileStat } from "@/types";
import type { IFileListCopyEvent } from "../Filelist/types";

type IGetCwdFiles = () => Promise<IViewFileStat[]>;

const MAX_EDITABLE_FILE_SIZE = 20 * 1024 * 1024;

export interface IFileEditorRef {
    getContent: () => string;
}

const SftpFileEditor = forwardRef<
    IFileEditorRef,
    { content: string; fileName: string }
>(function SftpFileEditor({ content, fileName }, ref) {
    const [value, setValue] = useState(content);

    useImperativeHandle(
        ref,
        () => ({
            getContent: () => value,
        }),
        [value],
    );

    return (
        <CodeMirror
            aria-label={fileName}
            value={value}
            height="min(65vh, 600px)"
            extensions={getLanguageExtensions(fileName)}
            onChange={setValue}
            basicSetup={{
                foldGutter: true,
                highlightActiveLine: true,
                bracketMatching: true,
                autocompletion: true,
            }}
        />
    );
});

function getLanguageExtensions(fileName: string): Extension[] {
    const name = fileName.toLowerCase();

    if (name.endsWith(".json") || name.endsWith(".jsonc")) {
        return [json()];
    }
    if (name.endsWith(".yaml") || name.endsWith(".yml")) {
        return [yaml()];
    }
    if (name.endsWith(".xml")) {
        return [xml()];
    }
    if (name.endsWith(".py")) {
        return [python()];
    }

    // TOML, INI, .env and .properties currently have no sufficiently
    // maintained CodeMirror 6 language package, so leave them as plain text.
    return [];
}

async function openExternal(
    file: IViewFileStat,
    app: "vscode" | "zed" | "default",
) {
    const content = await getSftpDownload(file.uri);
    await postFsOpen(file.name, app, content);
}

export async function handleViewEdit(file: IViewFileStat) {
    if (file.isDir || file.type !== "f") {
        return;
    }
    if (file.size > MAX_EDITABLE_FILE_SIZE) {
        throw new Error("文件超过 20 MiB，无法在线查看/编辑");
    }

    const editorRef = { current: null as IFileEditorRef | null };

    return new Promise<void>((resolve, reject) => {
        let isModalClosed = false;
        const modal = Modal.confirm({
            title: `查看/编辑：${file.name}`,
            width: 900,
            icon: null,
            okButtonProps: { disabled: true },
            content: (
                <div
                    style={{
                        minHeight: 160,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Spin tip="加载中..." />
                </div>
            ),
            // footer: (_, { OkBtn, CancelBtn }) => (
            //     <div
            //         style={{
            //             display: "flex",
            //             justifyContent: "space-between",
            //         }}
            //     >
            //         <Space.Compact>
            //             <Button onClick={() => openExternal(file, "default")}>
            //                 打开
            //             </Button>
            //             <Dropdown
            //                 placement="bottomRight"
            //                 menu={{
            //                     items: [
            //                         { key: "vscode", label: "VS Code" },
            //                         { key: "zed", label: "Zed" },
            //                         { key: "default", label: "默认 App" },
            //                     ],
            //                     onClick: ({ key }) =>
            //                         openExternal(
            //                             file,
            //                             key as "vscode" | "zed" | "default",
            //                         ),
            //                 }}
            //             >
            //                 <Button
            //                     icon={<DownOutlined />}
            //                     style={{ marginInlineStart: -1 }}
            //                 />
            //             </Dropdown>
            //         </Space.Compact>
            //         <Space>
            //             <CancelBtn />
            //             <OkBtn />
            //         </Space>
            //     </div>
            // ),
            onOk: async () => {
                try {
                    if (!editorRef.current) {
                        throw new Error("编辑器尚未准备完成");
                    }
                    await postSftpUpload(
                        file.uri,
                        new Blob([editorRef.current.getContent()], {
                            type: "text/plain;charset=utf-8",
                        }),
                    );
                    resolve();
                } catch (error) {
                    reject(error);
                    throw error;
                }
            },
            onCancel: () => {
                isModalClosed = true;
                modal.destroy();
                resolve();
            },
        });

        void getSftpDownload(file.uri)
            .then((response) => response.text())
            .then((content) => {
                if (isModalClosed) {
                    return;
                }
                modal.update({
                    content: (
                        <SftpFileEditor
                            ref={editorRef}
                            content={content}
                            fileName={file.name}
                        />
                    ),
                    okButtonProps: { disabled: false },
                });
            })
            .catch((error) => {
                if (isModalClosed) {
                    return;
                }
                modal.update({
                    content: (
                        <div
                            style={{
                                minHeight: 160,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            加载失败
                        </div>
                    ),
                });
                reject(error);
            });
    });
}

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
            content: "删除后将不可恢复，确认删除吗?",
            okText: "删除",
            cancelText: "取消",
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

export async function handleRename(
    file: IViewFileStat,
    getCwdFiles: IGetCwdFiles,
) {
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
                    failsRender: () => "批量操作失败",
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
                    failsRender: () => "批量操作失败",
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
