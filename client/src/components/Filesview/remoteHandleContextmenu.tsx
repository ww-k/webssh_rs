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

import openNativeFileSelector from "@/helpers/openNativeFileSelector";
import { isMac } from "@/helpers/platform";
import transferService from "@/services/transfer";

import popContextMenu from "../Contextmenu";
import {
    handleDelete,
    handleMkdir,
    handlePaste,
    handleRename,
} from "./remoteActions";

import type { IFile } from "@/types";
import type { IContextmenuDataItem } from "../Contextmenu/typings";
import type { IFileListCopyEvent } from "../Filelist/types";

export default function remoteHandleContextmenu(
    files: IFile[] | null,
    evt: MouseEvent | React.MouseEvent,
    context: {
        copyData?: IFileListCopyEvent;
        fileUri: string;
        getCwdFiles: () => Promise<IFile[]>;
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
                handleDelete(files, context.getCwdFiles);
            },
            iconRender: () => <DeleteOutlined />,
            tooltip: "Delete",
        });
        menus.push({
            label: "重命名",
            disabled: !(Array.isArray(files) && files.length === 1),
            click: async () => {
                handleRename(files[0], context.getCwdFiles);
            },
            iconRender: () => <EditOutlined />,
            tooltip: "F2",
        });
    } else {
        menus.push({
            label: "上传",
            click: async () => {
                const files = await openNativeFileSelector();
                const allPromises = files.map((file) => {
                    return transferService.upload({
                        file,
                        fileUri: `${context.fileUri}/${file.name}`,
                    });
                });
                await Promise.all(allPromises);
                await context.getCwdFiles();
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
            click: () => {
                handleMkdir(context.fileUri, context.getCwdFiles);
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

                await handlePaste(
                    context.copyData,
                    context.fileUri,
                    context.getCwdFiles,
                );
            },
            iconRender: () => <FileDoneOutlined />,
            tooltip: isMac ? "⌘+V" : "Ctrl+V",
        });
    }

    if (menus.length > 0) {
        popContextMenu(menus, evt.clientX, evt.clientY);
    }
}
