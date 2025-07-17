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

import type { IFile } from "@/types";
import type { IContextmenuDataItem } from "../Contextmenu/typings";
import type { IFileListCopyEvent } from "../Filelist/types";

export default function handleContextmenu(
    files: IFile[] | null,
    evt: MouseEvent | React.MouseEvent,
    option: {
        pasteData?: IFileListCopyEvent;
        fileUri: string;
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
            disabled: !(
                Array.isArray(files) &&
                files.length === 1 &&
                files[0].type === "f" &&
                files[0].size < 20971520
            ),
            click: () => {
                // TODO:
            },
            iconRender: () => <FileTextOutlined />,
        });
        menus.push({
            label: "剪切",
            click: () => {
                // TODO:
            },
            iconRender: () => <ScissorOutlined />,
            tooltip: isMac ? "⌘+X" : "Ctrl+X",
        });
        menus.push({
            label: "复制",
            click: () => {
                // TODO:
            },
            iconRender: () => <CopyOutlined />,
            tooltip: isMac ? "⌘+C" : "Ctrl+C",
        });
        menus.push({
            label: "删除",
            disabled: !files,
            click: () => {
                // TODO:
            },
            iconRender: () => <DeleteOutlined />,
            tooltip: "Delete",
        });
        menus.push({
            label: "重命名",
            disabled: !(Array.isArray(files) && files.length === 1),
            click: () => {
                // TODO:
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
                        fileUri: option.fileUri,
                    });
                });
            },
            iconRender: () => <UploadOutlined />,
        });
        menus.push({
            label: "刷新",
            click: () => {
                // TODO:
            },
            iconRender: () => <ReloadOutlined />,
        });
        menus.push({
            label: "创建文件夹",
            click: () => {
                // TODO:
            },
            iconRender: () => <FolderAddOutlined />,
        });
        menus.push({
            label: "粘贴",
            disabled: !(
                option.pasteData?.copyTarget &&
                Array.isArray(option.pasteData.copyTarget.files) &&
                option.pasteData.copyTarget.files.length > 0
            ),
            click: () => {
                // TODO:
            },
            iconRender: () => <FileDoneOutlined />,
            tooltip: isMac ? "⌘+V" : "Ctrl+V",
        });
    }

    if (menus.length > 0) {
        popContextMenu(menus, evt.clientX, evt.clientY);
    }
}
