import type { IViewFileStat } from "@/types";

export interface IFileListColumn {
    title: string;
    className?: string;
    dataIndex: string;
    sortKey?: string;
    width?: number;
    sorter?: boolean;
    display?: boolean;
    align?: React.CSSProperties["textAlign"];
    render?: (text: unknown, record: IViewFileStat, index: number) => string;
}

export interface IFileListDragDropEvent<T = File | IViewFileStat>
    extends Event {
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
    files: IViewFileStat[];
    type: "cut" | "copy";
}
