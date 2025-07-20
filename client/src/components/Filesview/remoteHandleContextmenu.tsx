import {
    CopyOutlined,
    DeleteOutlined,
    DownloadOutlined,
    EditOutlined,
    FileDoneOutlined,
    FileTextOutlined,
    FolderAddOutlined,
    ReloadOutlined,
    ScissorOutlined,
    UploadOutlined,
} from "@ant-design/icons";
import { Modal } from "antd";

import { postSftpMkdir, postSftpRename, postSftpRm, postSftpRmRf } from "@/api";
import { getFilePath } from "@/helpers/file_uri";
import openNativeFileSelector from "@/helpers/openNativeFileSelector";
import { posix } from "@/helpers/path";
import { isMac } from "@/helpers/platform";
import transferService from "@/services/transfer";

import popContextMenu from "../Contextmenu";
import handlePaste from "./handlePaste";

import type { IFile } from "@/types";
import type { IContextmenuDataItem } from "../Contextmenu/typings";
import type { IFileListCopyEvent } from "../Filelist/types";

export default function remoteHandleContextmenu(
    files: IFile[] | null,
    evt: MouseEvent | React.MouseEvent,
    context: {
        copyData?: IFileListCopyEvent;
        fileUri: string;
        getCwdFiles: () => void;
        setCopyData: (data: IFileListCopyEvent) => void;
    },
) {
    const menus: IContextmenuDataItem[] = [];

    console.log("Filesview/handleContextmenu:", files);
    if (Array.isArray(files) && files.length > 0) {
        menus.push({
            label: "下载",
            disabled: !(Array.isArray(files) && files.length > 0),
            click: () => {
                // TODO:
            },
            iconRender: () => <DownloadOutlined />,
        });
        menus.push({
            label: "查看/编辑",
            disabled: true,
            // disabled: !(
            //     Array.isArray(files) &&
            //     files.length === 1 &&
            //     files[0].type === "f" &&
            //     files[0].size < 20971520
            // ),
            click: () => {
                // TODO:
            },
            iconRender: () => <FileTextOutlined />,
        });
        menus.push({
            label: "剪切",
            click: () => {
                context.setCopyData({
                    fileUri: context.fileUri,
                    files,
                    type: "cut",
                });
            },
            iconRender: () => <ScissorOutlined />,
            tooltip: isMac ? "⌘+X" : "Ctrl+X",
        });
        menus.push({
            label: "复制",
            disabled: true,
            click: () => {
                context.setCopyData({
                    fileUri: context.fileUri,
                    files,
                    type: "copy",
                });
            },
            iconRender: () => <CopyOutlined />,
            tooltip: isMac ? "⌘+C" : "Ctrl+C",
        });
        menus.push({
            label: "删除",
            disabled: !files,
            click: async () => {
                Modal.confirm({
                    content: "删除后将不可恢复，确认删除吗?",
                    okText: "删除",
                    cancelText: "取消",
                    okType: "danger",
                    onOk: async () => {
                        for (const file of files) {
                            if (file.isDir) {
                                await postSftpRmRf(file.uri);
                            } else {
                                await postSftpRm(file.uri);
                            }
                        }
                        context.getCwdFiles();
                    },
                });
            },
            iconRender: () => <DeleteOutlined />,
            tooltip: "Delete",
        });
        menus.push({
            label: "重命名",
            disabled: !(Array.isArray(files) && files.length === 1),
            click: async () => {
                const newName = window.prompt("请输入文件名", files[0].name);
                if (!newName) {
                    return;
                }

                const filePath = getFilePath(files[0].uri);
                const newPath = posix.resolve(filePath, `../${newName}`);
                await postSftpRename(files[0].uri, newPath);
                context.getCwdFiles();
            },
            iconRender: () => <EditOutlined />,
            tooltip: "F2",
        });
    } else {
        menus.push({
            label: "上传",
            click: async () => {
                const files = await openNativeFileSelector();
                files.forEach((file) => {
                    transferService.upload({
                        file,
                        fileUri: context.fileUri,
                    });
                });
            },
            iconRender: () => <UploadOutlined />,
        });
        menus.push({
            label: "刷新",
            click: context.getCwdFiles,
            iconRender: () => <ReloadOutlined />,
        });
        menus.push({
            label: "创建文件夹",
            click: async () => {
                const newName = window.prompt("请输入文件夹名", "");
                if (!newName) {
                    return;
                }
                await postSftpMkdir(`${context.fileUri}/${newName}`);
                context.getCwdFiles();
            },
            iconRender: () => <FolderAddOutlined />,
        });
        menus.push({
            label: "粘贴",
            disabled: !(
                context.copyData &&
                Array.isArray(context.copyData.files) &&
                context.copyData.files.length > 0
            ),
            click: async () => {
                if (!context.copyData) return;

                await handlePaste(context.copyData, context.fileUri);
                context.getCwdFiles();
            },
            iconRender: () => <FileDoneOutlined />,
            tooltip: isMac ? "⌘+V" : "Ctrl+V",
        });
    }

    if (menus.length > 0) {
        popContextMenu(menus, evt.clientX, evt.clientY);
    }
}
