import type { Row, RowData, RowSelectionState } from "@tanstack/react-table";
import type { features } from "./table";

export type DropPosition = "before" | "after";

export interface DataTableColumn<TData extends RowData> {
    id: string;
    header: string | (() => React.ReactNode);
    accessor: (row: TData) => unknown;
    cell?: (value: unknown, row: TData, index: number) => React.ReactNode;
    width?: number;
    minWidth?: number;
    sortable?: boolean;
    align?: React.CSSProperties["textAlign"];
    className?: string;
}

export interface DataTableDropEvent<TData> {
    rows: TData[];
    files: File[];
    target: TData | null;
    dropPosition: DropPosition;
    event: DragEvent;
}

export interface DataTableProps<TData extends RowData> {
    className?: string;
    data: TData[];
    columns: DataTableColumn<TData>[];
    getRowId: (row: TData, index: number) => string;
    rowHeight?: number;
    selectable?: boolean;
    multiple?: boolean;
    virtual?: boolean;
    draggable?: boolean;
    canDropRow?: (row: TData) => boolean;
    showDropIndicator?: (row: TData) => boolean;
    loading?: boolean;
    emptyContent?: React.ReactNode;
    canSelectRow?: (row: TData) => boolean;
    onSelectionChange?: (rows: TData[]) => void;
    onRowClick?: (row: TData) => void;
    onRowDoubleClick?: (row: TData, event: MouseEvent) => void;
    onContextMenu?: (rows: TData[] | null, event: MouseEvent) => void;
    onHeaderContextMenu?: (event: React.MouseEvent) => void;
    onDrop?: (event: DataTableDropEvent<TData>) => void;
    onEnter?: (row: TData) => void;
    onBackspace?: () => void;
    getRowLabel?: (row: TData) => string;
    onDelete?: (rows: TData[]) => void;
    onRename?: (row: TData) => void;
    onCopy?: (rows: TData[], cut: boolean) => void;
    onPaste?: () => void;
    getSubRows?: (
        row: TData,
        index: number,
    ) => ReadonlyArray<TData> | undefined;
    defaultExpanded?: boolean;
    expandIcon?: (
        row: TData,
        expanded: boolean,
        onToggle: () => void,
    ) => React.ReactNode;
}

export type TableRow<TData extends RowData> = Row<typeof features, TData>;
export type TableRowSelection = RowSelectionState;
