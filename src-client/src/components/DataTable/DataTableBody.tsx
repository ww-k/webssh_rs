import { CaretDownOutlined, CaretRightOutlined } from "@ant-design/icons";
import {
    type Cell,
    flexRender,
    type Row,
    type RowData,
    type RowSelectionState,
} from "@tanstack/react-table";
import classNames from "clsx";
import { memo } from "react";

import { currentSelectedRowsForDrag } from "./utils";

import type { features } from "./table";
import type { DataTableColumn, DropPosition } from "./types";

export interface DataTableBodyProps<TData extends RowData> {
    rows: Row<typeof features, TData>[];
    visibleRows: Row<typeof features, TData>[];
    startIndex: number;
    rowHeight: number;
    tableWidth: number;
    virtual: boolean;
    columns: DataTableColumn<TData>[];
    columnWidths: Record<string, number>;
    selectable: boolean;
    multiple: boolean;
    draggable: boolean;
    canDropRow?: (row: TData) => boolean;
    showDropIndicator?: (row: TData) => boolean;
    dragging: boolean;
    dropTargetId: string | null;
    dropPosition: DropPosition | null;
    getRowId: (row: TData, index: number) => string;
    data: TData[];
    getSubRows?: (
        row: TData,
        index: number,
    ) => ReadonlyArray<TData> | undefined;
    expandIcon?: (
        row: TData,
        expanded: boolean,
        onToggle: () => void,
    ) => React.ReactNode;
    activeId: string | null;
    rowSelection: RowSelectionState;
    selectionAnchor: React.MutableRefObject<string | null>;
    selectedRows: React.MutableRefObject<Row<typeof features, TData>[]>;
    setRowSelection: React.Dispatch<React.SetStateAction<RowSelectionState>>;
    setActiveId: React.Dispatch<React.SetStateAction<string | null>>;
    setDragging: React.Dispatch<React.SetStateAction<boolean>>;
    setDropTargetId: React.Dispatch<React.SetStateAction<string | null>>;
    setDropPosition: React.Dispatch<React.SetStateAction<DropPosition | null>>;
    dragRows: React.MutableRefObject<TData[] | null>;
    dragStartIndex: React.MutableRefObject<number | null>;
    selectIndex: (index: number, additive: boolean, range: boolean) => void;
    onRowClick?: (row: TData) => void;
    onRowDoubleClick?: (row: TData, event: MouseEvent) => void;
    onContextMenu?: (rows: TData[] | null, event: MouseEvent) => void;
    onDrop: (
        target: TData | null,
        event: React.DragEvent | DragEvent,
        dropPosition: DropPosition,
    ) => void;
}

function DataTableBody<TData extends RowData>({
    rows,
    visibleRows,
    startIndex,
    rowHeight,
    tableWidth,
    virtual,
    columns,
    columnWidths,
    selectable,
    multiple,
    draggable,
    canDropRow,
    showDropIndicator,
    dragging,
    dropTargetId,
    dropPosition,
    getRowId,
    data,
    getSubRows,
    expandIcon,
    activeId,
    rowSelection,
    selectionAnchor,
    selectedRows,
    setRowSelection,
    setActiveId,
    setDragging,
    setDropTargetId,
    setDropPosition,
    dragRows,
    dragStartIndex,
    selectIndex,
    onRowClick,
    onRowDoubleClick,
    onContextMenu,
    onDrop,
}: DataTableBodyProps<TData>) {
    return (
        <div
            className="WebSSH-DataTableBody"
            style={{ height: rows.length * rowHeight }}
            onMouseDown={(event) => {
                if (!selectable || !multiple) return;
                if ((event.target as HTMLElement).closest("tbody tr")) return;
                dragStartIndex.current = Math.floor(
                    (event.clientY -
                        event.currentTarget.getBoundingClientRect().top) /
                        rowHeight,
                );
            }}
            onMouseUp={() => {
                dragStartIndex.current = null;
            }}
            onMouseMove={(event) => {
                if (
                    !selectable ||
                    !multiple ||
                    dragStartIndex.current === null ||
                    event.buttons !== 1
                ) {
                    return;
                }
                const index = Math.max(
                    0,
                    Math.min(
                        rows.length - 1,
                        Math.floor(
                            (event.clientY -
                                event.currentTarget.getBoundingClientRect()
                                    .top) /
                                rowHeight,
                        ),
                    ),
                );
                const [from, to] = [dragStartIndex.current, index].sort(
                    (a, b) => a - b,
                );
                const next: RowSelectionState = {};
                for (let i = from; i <= to; i += 1) {
                    if (rows[i]?.getCanSelect()) next[rows[i].id] = true;
                }
                setRowSelection(next);
            }}
        >
            <table
                className="WebSSH-DataTableTable WebSSH-DataTableVirtualTable"
                style={{
                    width: tableWidth,
                    top: virtual ? startIndex * rowHeight : 0,
                }}
            >
                <colgroup>
                    {multiple && selectable && <col style={{ width: 26 }} />}
                    {columns.map((column) => (
                        <col
                            key={column.id}
                            style={{
                                width:
                                    columnWidths[column.id] ??
                                    column.width ??
                                    160,
                            }}
                        />
                    ))}
                </colgroup>
                <tbody>
                    {visibleRows.map((row, visibleIndex) => (
                        <DataTableRow
                            key={row.id}
                            row={row}
                            rowIndex={startIndex + visibleIndex}
                            rowHeight={rowHeight}
                            columns={columns}
                            selectable={selectable}
                            multiple={multiple}
                            draggable={draggable}
                            canDropRow={canDropRow}
                            showDropIndicator={showDropIndicator}
                            dragging={dragging}
                            dropTarget={dropTargetId === row.id}
                            dropPosition={
                                dropTargetId === row.id ? dropPosition : null
                            }
                            selected={Boolean(rowSelection[row.id])}
                            disabled={false}
                            active={activeId === row.id}
                            getRowId={getRowId}
                            data={data}
                            getSubRows={getSubRows}
                            expandIcon={expandIcon}
                            selectionAnchor={selectionAnchor}
                            selectedRows={selectedRows}
                            setRowSelection={setRowSelection}
                            setActiveId={setActiveId}
                            setDragging={setDragging}
                            setDropTargetId={setDropTargetId}
                            setDropPosition={setDropPosition}
                            dragRows={dragRows}
                            selectIndex={selectIndex}
                            onRowClick={onRowClick}
                            onRowDoubleClick={onRowDoubleClick}
                            onContextMenu={onContextMenu}
                            onDrop={onDrop}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

interface DataTableRowProps<TData extends RowData> {
    row: Row<typeof features, TData>;
    rowIndex: number;
    rowHeight: number;
    columns: DataTableColumn<TData>[];
    selectable: boolean;
    multiple: boolean;
    draggable: boolean;
    canDropRow?: (row: TData) => boolean;
    showDropIndicator?: (row: TData) => boolean;
    dragging: boolean;
    dropTarget: boolean;
    dropPosition: DropPosition | null;
    selected: boolean;
    disabled: boolean;
    active: boolean;
    getRowId: (row: TData, index: number) => string;
    data: TData[];
    getSubRows?: (
        row: TData,
        index: number,
    ) => ReadonlyArray<TData> | undefined;
    expandIcon?: (
        row: TData,
        expanded: boolean,
        onToggle: () => void,
    ) => React.ReactNode;
    selectionAnchor: React.MutableRefObject<string | null>;
    selectedRows: React.MutableRefObject<Row<typeof features, TData>[]>;
    setRowSelection: React.Dispatch<React.SetStateAction<RowSelectionState>>;
    setActiveId: React.Dispatch<React.SetStateAction<string | null>>;
    setDragging: React.Dispatch<React.SetStateAction<boolean>>;
    setDropTargetId: React.Dispatch<React.SetStateAction<string | null>>;
    setDropPosition: React.Dispatch<React.SetStateAction<DropPosition | null>>;
    dragRows: React.MutableRefObject<TData[] | null>;
    selectIndex: (index: number, additive: boolean, range: boolean) => void;
    onRowClick?: (row: TData) => void;
    onRowDoubleClick?: (row: TData, event: MouseEvent) => void;
    onContextMenu?: (rows: TData[] | null, event: MouseEvent) => void;
    onDrop: (
        target: TData | null,
        event: React.DragEvent | DragEvent,
        dropPosition: DropPosition,
    ) => void;
}

function DataTableRow<TData extends RowData>({
    row,
    rowIndex,
    rowHeight,
    columns,
    selectable,
    multiple,
    draggable,
    canDropRow,
    showDropIndicator,
    dragging,
    dropTarget,
    dropPosition,
    selected,
    disabled,
    active,
    getRowId,
    data,
    getSubRows,
    expandIcon,
    selectionAnchor,
    selectedRows,
    setRowSelection,
    setActiveId,
    setDragging,
    setDropTargetId,
    setDropPosition,
    dragRows,
    selectIndex,
    onRowClick,
    onRowDoubleClick,
    onContextMenu,
    onDrop,
}: DataTableRowProps<TData>) {
    const original = row.original;
    const canDrop = canDropRow?.(original) ?? true;
    const showIndicator = showDropIndicator?.(original) ?? true;

    return (
        <tr
            data-row-id={row.id}
            className={classNames({
                "WebSSH-DataTableTrActive": selected,
                "WebSSH-DataTableTrDisabled": disabled,
                "WebSSH-DataTableTrActiveBorder": active,
                "WebSSH-DataTableTrDropTarget": dropTarget,
                "WebSSH-DataTableTrDropBefore":
                    showIndicator && dropTarget && dropPosition === "before",
                "WebSSH-DataTableTrDropAfter":
                    showIndicator && dropTarget && dropPosition === "after",
                "WebSSH-DataTableTrDropAllowed": dragging && canDrop,
                "WebSSH-DataTableTrDropDisabled": dragging && !canDrop,
            })}
            style={{ height: rowHeight }}
            aria-disabled={disabled}
            draggable={draggable}
            onClick={(event) => {
                const additive = event.ctrlKey || event.metaKey;
                const range = event.shiftKey;
                if (range && selectionAnchor.current === null) {
                    selectionAnchor.current = row.id;
                }
                if (row.getCanSelect()) selectIndex(rowIndex, additive, range);
                onRowClick?.(original);
            }}
            onDoubleClick={(event) =>
                onRowDoubleClick?.(original, event.nativeEvent)
            }
            onContextMenu={(event) => {
                event.preventDefault();
                const currentSelectedRows = selectedRows.current;
                const isSelected =
                    row.getCanSelect() &&
                    currentSelectedRows.some((item) => item.id === row.id);
                const selectedForContext = isSelected
                    ? currentSelectedRows.map((item) => item.original)
                    : [original];
                if (row.getCanSelect() && !isSelected) {
                    setRowSelection({ [row.id]: true });
                }
                if (row.getCanSelect()) selectionAnchor.current = row.id;
                onContextMenu?.(selectedForContext, event.nativeEvent);
            }}
            onDragStart={(event) => {
                const selectedForDrag = currentSelectedRowsForDrag(
                    selectedRows.current,
                    row,
                    original,
                );
                dragRows.current = selectedForDrag;
                document.body.dataset.websshTableDragging = "true";
                event.dataTransfer.effectAllowed = "move";
                const rowIds = JSON.stringify(
                    selectedForDrag.map((item) =>
                        getRowId(item, data.indexOf(item)),
                    ),
                );
                try {
                    event.dataTransfer.setData(
                        "application/x-webssh-table-rows",
                        rowIds,
                    );
                } catch (error) {
                    console.log(
                        "[drag-debug] DataTable custom setData failed",
                        error,
                    );
                }
                event.dataTransfer.setData("text/plain", rowIds);
                setDragging(true);
            }}
            onDragEnd={() => {
                dragRows.current = null;
                delete document.body.dataset.websshTableDragging;
                setDragging(false);
                setDropTargetId(null);
                setDropPosition(null);
            }}
            onDragOver={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                const nextDropPosition =
                    event.clientY < bounds.top + bounds.height / 2
                        ? "before"
                        : "after";
                setDropTargetId(row.id);
                setDropPosition(nextDropPosition);
                if (!canDrop) {
                    event.dataTransfer.dropEffect = "none";
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
            }}
            onDragLeave={(event) => {
                if (
                    !event.currentTarget.contains(event.relatedTarget as Node)
                ) {
                    setDropTargetId(null);
                    setDropPosition(null);
                }
            }}
            onDrop={(event) => {
                if (!canDrop) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                const bounds = event.currentTarget.getBoundingClientRect();
                const nextDropPosition =
                    event.clientY < bounds.top + bounds.height / 2
                        ? "before"
                        : "after";
                onDrop(original, event, nextDropPosition);
                delete document.body.dataset.websshTableDragging;
                setDragging(false);
                setDropTargetId(null);
                setDropPosition(null);
            }}
        >
            {multiple && selectable && (
                <td className="WebSSH-DataTableCellColCheckbox">
                    <input
                        type="checkbox"
                        checked={selected}
                        disabled={disabled}
                        aria-label={`Select row ${rowIndex + 1}`}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                            row.toggleSelected(event.target.checked);
                            selectionAnchor.current = row.id;
                            setActiveId(row.id);
                        }}
                    />
                </td>
            )}
            {row
                .getAllCells()
                .map(
                    (
                        cell: Cell<typeof features, TData, unknown>,
                        cellIndex,
                    ) => {
                        const column = columns[cellIndex];
                        const isTreeColumn =
                            Boolean(getSubRows) && cellIndex === 0;
                        return (
                            <td
                                key={cell.id}
                                className={column?.className}
                                style={{ textAlign: column?.align ?? "left" }}
                            >
                                <div
                                    className={classNames(
                                        isTreeColumn &&
                                            "WebSSH-DataTableTreeCell",
                                    )}
                                    style={
                                        isTreeColumn
                                            ? { paddingLeft: row.depth * 20 }
                                            : undefined
                                    }
                                >
                                    {isTreeColumn &&
                                        (expandIcon ? (
                                            expandIcon(
                                                original,
                                                row.getIsExpanded(),
                                                () => row.toggleExpanded(),
                                            )
                                        ) : row.getCanExpand() ? (
                                            <button
                                                type="button"
                                                className="WebSSH-DataTableExpandIcon"
                                                aria-label="Toggle row"
                                                aria-expanded={row.getIsExpanded()}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    row.toggleExpanded();
                                                }}
                                            >
                                                {row.getIsExpanded() ? (
                                                    <CaretDownOutlined />
                                                ) : (
                                                    <CaretRightOutlined />
                                                )}
                                            </button>
                                        ) : null)}
                                    {flexRender(
                                        cell.column.columnDef.cell,
                                        cell.getContext(),
                                    )}
                                </div>
                            </td>
                        );
                    },
                )}
        </tr>
    );
}

export default memo(DataTableBody) as typeof DataTableBody;
