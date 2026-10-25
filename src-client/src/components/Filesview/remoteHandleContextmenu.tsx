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

import { isMac } from "@/helpers/platform";
import i18n from "@/i18n";
import transferService from "@/services/transfer";

import popContextMenu from "../Contextmenu";
import renderFsSelector from "../FsSelector/render";
import {
    handleDelete,
    handleMkdir,
    handlePaste,
    handleRename,
} from "./remoteActions";

import type { IViewFileStat } from "@/types";
import type { IContextmenuDataItem } from "../Contextmenu/typings";
import type { IFileListCopyEvent } from "../Filelist/types";

export default function remoteHandleContextmenu(
    files: IViewFileStat[] | null,
    evt: MouseEvent | React.MouseEvent,
    context: {
        copyData?: IFileListCopyEvent;
        fileUri: string;
        getCwdFiles: () => Promise<IViewFileStat[]>;
        setCopyData: (data: IFileListCopyEvent) => void;
        onViewEdit: (file: IViewFileStat) => void;
    },
) {
    const menus: IContextmenuDataItem[] = [];

    console.log("Filesview/handleContextmenu:", files);
    if (Array.isArray(files) && files.length > 0) {
        menus.push({
            label: i18n.t("files_menu_download"),
            disabled: false,
            click: async () => {
                const [localDir] = await renderFsSelector({
                    mode: "directory",
                    defaultDirectory: "downloads",
                    title: i18n.t("files_menu_select_download_directory"),
                });
                await transferService.createDownloadBatch({
                    sources: files.map((file) => file.uri),
                    localDir,
                });
            },
            iconRender: () => <DownloadOutlined />,
        });
        menus.push({
            label: i18n.t("files_menu_view_edit"),
            disabled: !(
                files.length === 1 &&
                !files[0].isDir &&
                files[0].type === "f" &&
                files[0].size <= 20 * 1024 * 1024
            ),
            click: async () => {
                context.onViewEdit(files[0]);
            },
            iconRender: () => <FileTextOutlined />,
        });
        menus.push({
            label: i18n.t("files_menu_cut"),
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
            label: i18n.t("files_menu_copy"),
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
            label: i18n.t("app_btn_delete"),
            disabled: !files,
            click: async () => {
                handleDelete(files, context.getCwdFiles);
            },
            iconRender: () => <DeleteOutlined />,
            tooltip: "Delete",
        });
        menus.push({
            label: i18n.t("files_menu_rename"),
            disabled: !(Array.isArray(files) && files.length === 1),
            click: async () => {
                handleRename(files[0], context.getCwdFiles);
            },
            iconRender: () => <EditOutlined />,
            tooltip: "F2",
        });
    } else {
        menus.push({
            label: i18n.t("files_menu_upload"),
            click: async () => {
                const localPaths = await renderFsSelector({
                    mode: "any",
                    multiple: true,
                    title: i18n.t("files_menu_select_upload_file"),
                });
                await transferService.createUploadBatch({
                    sources: localPaths,
                    targetUri: context.fileUri,
                });
                await context.getCwdFiles();
            },
            iconRender: () => <UploadOutlined />,
        });
        menus.push({
            label: i18n.t("app_btn_refresh"),
            click: context.getCwdFiles,
            iconRender: () => <ReloadOutlined />,
        });
        menus.push({
            label: i18n.t("files_menu_create_folder"),
            click: () => {
                handleMkdir(context.fileUri, context.getCwdFiles);
            },
            iconRender: () => <FolderAddOutlined />,
        });
        menus.push({
            label: i18n.t("files_menu_paste"),
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
