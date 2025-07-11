import type { IFile } from "@/types";

export interface IFileListDragDropEvent<T = File | IFile> extends Event {
    dragTarget: {
        host: string;
        path?: string;
        fileUrl?: string;
        files: T[];
    };
    dropTarget: {
        host: string;
        path: string;
        fileUrl?: string;
    };
}

export interface IFileListCopyEvent {
    copyTarget: {
        host: string;
        fileUrl: string;
        files: IFile[];
        type: "cut" | "copy";
    };
}

export interface IFilelistProps {
    className: string;
    data: IFile[];
    host: string;
    fileUrl: string;
    loading?: boolean;
    enableKeyCopy?: boolean;
    enableCheckbox?: boolean;
    draggable?: boolean;
    emptyContent?: React.ReactElement | (() => React.ReactElement);
    hideParentFile?: boolean;
    pasteData?: IFileListCopyEvent;
    onSelecteChange?: (selected: IFile[]) => void;
    onFileClick?: (file: IFile) => void;
    onFileDoubleClick?: (file: IFile) => void;
    onContextMenu?: (files: IFile[], evt: MouseEvent) => void;
    onDrop?: (evt: IFileListDragDropEvent) => void;
    onEnter?: (file: IFile) => void;
    onDelete?: (files: IFile[]) => void;
    onCopy?: (evt: IFileListCopyEvent) => void;
    onPaste?: (evt: IFileListCopyEvent) => void;
}

export interface IFilelistTbodyProps {
    data: IFile[];
    host: string;
    fileUrl: string;
    selected?: IFile[];
    disabled?: IFile[];
    activeKey?: string;
    enableCheckbox: boolean;
    onSelected?: (selected: IFile[]) => void;
    onFileDoubleClick?: (file: IFile) => void;
    onContextMenu?: (files: IFile[], evt: MouseEvent) => void;
    onActive?: (index: number) => void;
    onDrop?: (evt: IFileListDragDropEvent) => void;
}

export interface IFilelistTheadProps {
    enableCheckbox: boolean;
    onThClick: (key: string, ascend: boolean) => void;
    onCheckChange?: (checked: boolean) => void;
}

export interface IFileListColumn {
    title: string;
    className?: string;
    dataIndex: string;
    sortKey?: string;
    width?: number;
    sorter?: boolean;
    display?: boolean;
    align?: React.CSSProperties["textAlign"];
    headerAlign?: React.CSSProperties["textAlign"];
    render?: (text: unknown, record: IFile, index: number) => string;
}
