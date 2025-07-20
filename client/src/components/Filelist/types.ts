import type { IFile } from "@/types";

export interface IFileListColumn {
    title: string;
    className?: string;
    dataIndex: string;
    sortKey?: string;
    width?: number;
    sorter?: boolean;
    display?: boolean;
    align?: React.CSSProperties["textAlign"];
    render?: (text: unknown, record: IFile, index: number) => string;
}

export interface IFileListDragDropEvent<T = File | IFile> extends Event {
    dragTarget: {
        fileUri?: string;
        files: T[];
    };
    dropTarget: {
        fileUri?: string;
    };
}

export interface IFileListCopyEvent {
    fileUri: string;
    files: IFile[];
    type: "cut" | "copy";
}
