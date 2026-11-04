import { CaretDownOutlined, CaretUpOutlined } from "@ant-design/icons";
import {
    type ColumnDef,
    createCoreRowModel,
    createSortedRowModel,
    flexRender,
    type RowData,
    type RowSelectionState,
    rowSelectionFeature,
    rowSortingFeature,
    type SortingState,
    tableFeatures,
    useTable,
} from "@tanstack/react-table";
import classNames from "clsx";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import ResizeLine from "@/components/ResizeLine";

import "./index.css";

const features = tableFeatures({
    rowSelectionFeature,
    rowSortingFeature,
    coreRowModel: createCoreRowModel(),
    sortedRowModel: createSortedRowModel(),
});
const ROW_OVERSCAN = 10;
const VIRTUAL_WINDOW_STEP = 8;

function getVirtualStartIndex(bodyScrollTop: number, rowHeight: number) {
    const firstVisibleIndex = Math.floor(bodyScrollTop / rowHeight);
    const windowStart =
        Math.floor(firstVisibleIndex / VIRTUAL_WINDOW_STEP) *
        VIRTUAL_WINDOW_STEP;
    return Math.max(0, windowStart - ROW_OVERSCAN);
}

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
    event: DragEvent;
}

export interface DataTableProps<TData extends RowData> {
    className?: string;
    data: TData[];
    columns: DataTableColumn<TData>[];
    getRowId: (row: TData, index: number) => string;
    rowHeight?: number;
    multiple?: boolean;
    virtual?: boolean;
    draggable?: boolean;
    loading?: boolean;
    emptyContent?: React.ReactNode;
    isRowSelectable?: (row: TData) => boolean;
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
}

function DataTable<TData extends RowData>({
    className,
    data,
    columns,
    getRowId,
    rowHeight = 24,
    multiple = true,
    virtual = true,
    draggable = false,
    loading = false,
    emptyContent = "No data",
    isRowSelectable,
    onSelectionChange,
    onRowClick,
    onRowDoubleClick,
    onContextMenu,
    onHeaderContextMenu,
    onDrop,
    onEnter,
    onBackspace,
    getRowLabel,
    onDelete,
    onRename,
    onCopy,
    onPaste,
}: DataTableProps<TData>) {
    const rootRef = useRef<HTMLDivElement>(null);
    const [sorting, setSorting] = useState<SortingState>([]);
    const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
    const [activeId, setActiveId] = useState<string | null>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const scrollTopRef = useRef(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
        () =>
            Object.fromEntries(
                columns.map((column) => [column.id, column.width ?? 160]),
            ),
    );
    const resizeOrigin = useRef<Record<string, number>>({});
    const dragStartIndex = useRef<number | null>(null);
    const selectionAnchor = useRef<string | null>(null);
    const dragRows = useRef<TData[] | null>(null);
    const typeAhead = useRef("");
    const typeAheadTimer = useRef<number | undefined>(undefined);

    const tableColumns = useMemo<ColumnDef<typeof features, TData, unknown>[]>(
        () =>
            columns.map((column) => ({
                id: column.id,
                accessorFn: column.accessor,
                header: column.header,
                cell: (context) =>
                    column.cell
                        ? column.cell(
                              context.getValue(),
                              context.row.original,
                              context.row.index,
                          )
                        : String(context.getValue() ?? ""),
                enableSorting: column.sortable !== false,
                size: column.width ?? 160,
                minSize: column.minWidth ?? 48,
            })),
        [columns],
    );

    const table = useTable<typeof features, TData>({
        features,
        data,
        columns: tableColumns,
        getRowId,
        state: { sorting, rowSelection },
        onSortingChange: setSorting,
        onRowSelectionChange: setRowSelection,
        enableRowSelection: (row) => isRowSelectable?.(row.original) ?? true,
        enableMultiRowSelection: multiple,
    });

    const rows = table.getRowModel().rows;
    const rowIndexById = useMemo(
        () => new Map(rows.map((row, index) => [row.id, index])),
        [rows],
    );
    const selectableRows = useMemo(
        () => rows.filter((row) => row.getCanSelect()),
        [rows],
    );
    const bodyScrollTop = Math.max(0, scrollTop - 30);
    const selectedRows = useMemo(
        () =>
            Object.keys(rowSelection)
                .map((id) => rowIndexById.get(id))
                .filter((index): index is number => index !== undefined)
                .sort((a, b) => a - b)
                .map((index) => rows[index]),
        [rowIndexById, rowSelection, rows],
    );
    const visibleCount = virtual
        ? Math.ceil(viewportHeight / rowHeight) + ROW_OVERSCAN * 2
        : rows.length;
    const startIndex = virtual
        ? getVirtualStartIndex(bodyScrollTop, rowHeight)
        : 0;
    const visibleRows = rows.slice(startIndex, startIndex + visibleCount);
    const tableWidth = columns.reduce(
        (width, column) =>
            width + (columnWidths[column.id] ?? column.width ?? 160),
        multiple ? 26 : 0,
    );

    useEffect(() => {
        setRowSelection((previous) => {
            const ids = new Set(data.map(getRowId));
            const next = Object.fromEntries(
                Object.entries(previous).filter(([id]) => ids.has(id)),
            );
            return Object.keys(next).length === Object.keys(previous).length
                ? previous
                : next;
        });
    }, [data, getRowId]);

    useEffect(() => {
        const element = rootRef.current;
        if (!element) return;
        const observer = new ResizeObserver(() => {
            setViewportHeight(element.clientHeight - 30);
        });
        observer.observe(element);
        setViewportHeight(element.clientHeight - 30);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        onSelectionChange?.(selectedRows.map((row) => row.original));
    }, [onSelectionChange, selectedRows]);

    const selectIndex = useCallback(
        (index: number, additive: boolean, range: boolean) => {
            const row = rows[index];
            if (!row?.getCanSelect()) return;
            if (!multiple) {
                setRowSelection({ [row.id]: true });
                selectionAnchor.current = row.id;
            } else if (range && selectionAnchor.current !== null) {
                const anchorIndex = rows.findIndex(
                    (item) => item.id === selectionAnchor.current,
                );
                const [from, to] = [
                    anchorIndex >= 0 ? anchorIndex : index,
                    index,
                ].sort((a, b) => a - b);
                const next: RowSelectionState = additive
                    ? { ...rowSelection }
                    : {};
                for (let i = from; i <= to; i += 1) {
                    if (rows[i].getCanSelect()) next[rows[i].id] = true;
                }
                setRowSelection(next);
                setActiveId(row.id);
                if (anchorIndex < 0) selectionAnchor.current = row.id;
            } else if (additive) {
                setRowSelection((previous) => {
                    const next = { ...previous };
                    if (next[row.id]) delete next[row.id];
                    else next[row.id] = true;
                    return next;
                });
                selectionAnchor.current = row.id;
                setActiveId(row.id);
            } else {
                setRowSelection({ [row.id]: true });
                selectionAnchor.current = row.id;
                setActiveId(row.id);
            }
        },
        [multiple, rowSelection, rows],
    );

    const ensureRowVisible = useCallback(
        (index: number) => {
            const element = rootRef.current;
            if (!element) return;
            const headerHeight = 30;
            const rowTop = headerHeight + index * rowHeight;
            const rowBottom = rowTop + rowHeight;
            const visibleTop = element.scrollTop + headerHeight;
            const visibleBottom = element.scrollTop + element.clientHeight;

            if (rowTop < visibleTop) {
                element.scrollTo({ top: rowTop - headerHeight });
            } else if (rowBottom > visibleBottom) {
                element.scrollTo({ top: rowBottom - element.clientHeight });
            }
        },
        [rowHeight],
    );

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const selected = selectedRows.map((row) => row.original);
        const currentId =
            activeId && rowSelection[activeId]
                ? activeId
                : selectedRows[selectedRows.length - 1]?.id;
        const currentIndex = rows.findIndex((row) => row.id === currentId);
        const isModifier = event.ctrlKey || event.metaKey;
        if (isModifier && event.key.toLowerCase() === "a") {
            event.preventDefault();
            const next: RowSelectionState = {};
            selectableRows.forEach((row) => {
                next[row.id] = true;
            });
            setRowSelection(next);
            setActiveId(null);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const direction = event.key === "ArrowDown" ? 1 : -1;
            if (selectableRows.length === 0) return;
            const currentSelectableIndex = selectableRows.findIndex(
                (row) => row.id === currentId,
            );
            const nextSelectableIndex =
                currentSelectableIndex < 0
                    ? direction > 0
                        ? 0
                        : selectableRows.length - 1
                    : Math.max(
                          0,
                          Math.min(
                              selectableRows.length - 1,
                              currentSelectableIndex + direction,
                          ),
                      );
            const nextRow = selectableRows[nextSelectableIndex];
            const nextIndex = rowIndexById.get(nextRow.id) ?? 0;
            if (nextRow.id !== currentId) {
                selectIndex(nextIndex, false, event.shiftKey);
            }
            ensureRowVisible(nextIndex);
        } else if (event.key === "Backspace") {
            event.preventDefault();
            onBackspace?.();
        } else if (event.key === "Enter" && selected.length === 1) {
            onEnter?.(selected[0]);
        } else if (event.key === "Delete" && selected.length > 0) {
            onDelete?.(selected);
        } else if (event.key === "F2" && selected.length === 1) {
            onRename?.(selected[0]);
        } else if (isModifier && event.key.toLowerCase() === "c") {
            onCopy?.(selected, false);
        } else if (isModifier && event.key.toLowerCase() === "x") {
            onCopy?.(selected, true);
        } else if (isModifier && event.key.toLowerCase() === "v") {
            onPaste?.();
        } else if (
            event.key.length === 1 &&
            !isModifier &&
            !event.altKey &&
            /[\p{L}\p{N}]/u.test(event.key)
        ) {
            typeAhead.current += event.key.toLocaleLowerCase();
            window.clearTimeout(typeAheadTimer.current);
            typeAheadTimer.current = window.setTimeout(() => {
                typeAhead.current = "";
            }, 1000);
            const offset = typeAhead.current.length > 1 ? 0 : 1;
            const nextIndex = rows.length
                ? Array.from(
                      { length: rows.length },
                      (_, index) =>
                          (currentIndex + index + offset) % rows.length,
                  ).find((index) =>
                      (
                          getRowLabel?.(rows[index].original) ??
                          String(rows[index].getAllCells()[0]?.getValue() ?? "")
                      )
                          .toLocaleLowerCase()
                          .startsWith(typeAhead.current),
                  )
                : undefined;
            if (nextIndex !== undefined) {
                selectIndex(nextIndex, false, false);
                ensureRowVisible(nextIndex);
            }
        }
    };

    const handleDrop = (target: TData | null, event: React.DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const nativeEvent = event.nativeEvent;
        let sourceRows = dragRows.current;
        if (!sourceRows) {
            const serialized = event.dataTransfer.getData(
                "application/x-webssh-table-rows",
            );
            if (serialized) {
                try {
                    const ids = new Set(JSON.parse(serialized) as string[]);
                    sourceRows = rows
                        .filter((row) => ids.has(row.id))
                        .map((row) => row.original);
                } catch {
                    sourceRows = [];
                }
            }
        }
        onDrop?.({
            rows: sourceRows ?? [],
            files: Array.from(event.dataTransfer.files),
            target,
            event: nativeEvent,
        });
        dragRows.current = null;
    };

    return (
        <div
            ref={rootRef}
            className={classNames("WebSSH-DataTable", className, {
                "WebSSH-DataTableLoading": loading,
            })}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onScroll={(event) => {
                const nextScrollTop = event.currentTarget.scrollTop;
                scrollTopRef.current = nextScrollTop;
                const nextStartIndex = virtual
                    ? getVirtualStartIndex(
                          Math.max(0, nextScrollTop - 30),
                          rowHeight,
                      )
                    : 0;
                if (nextStartIndex !== startIndex) {
                    setScrollTop(nextScrollTop);
                }
            }}
            onMouseDown={() => rootRef.current?.focus({ preventScroll: true })}
            onContextMenu={(event) => {
                if ((event.target as HTMLElement).closest("tbody")) return;
                event.preventDefault();
                onHeaderContextMenu?.(event);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDrop(null, event)}
        >
            <div
                className="WebSSH-DataTableHeader"
                style={{ width: tableWidth }}
            >
                <table className="filelistTable" style={{ width: tableWidth }}>
                    <colgroup>
                        {multiple && <col style={{ width: 26 }} />}
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
                    <thead>
                        <tr>
                            {multiple && (
                                <th className="filelistTableCellColCheckbox">
                                    <input
                                        type="checkbox"
                                        aria-label="Select all rows"
                                        checked={
                                            selectableRows.length > 0 &&
                                            selectedRows.length ===
                                                selectableRows.length
                                        }
                                        onChange={(event) => {
                                            const next: RowSelectionState = {};
                                            if (event.target.checked) {
                                                selectableRows.forEach(
                                                    (row) => {
                                                        next[row.id] = true;
                                                    },
                                                );
                                            }
                                            setRowSelection(next);
                                            setActiveId(null);
                                        }}
                                    />
                                </th>
                            )}
                            {table
                                .getHeaderGroups()[0]
                                ?.headers.map((header, index) => {
                                    const column = columns[index];
                                    const sorted = header.column.getIsSorted();
                                    return (
                                        <th
                                            key={header.id}
                                            className={column?.className}
                                            style={{
                                                width:
                                                    columnWidths[
                                                        header.column.id
                                                    ] ??
                                                    column?.width ??
                                                    160,
                                                textAlign:
                                                    column?.align ?? "left",
                                            }}
                                            onClick={(event) => {
                                                if (
                                                    (
                                                        event.target as HTMLElement
                                                    ).closest(
                                                        ".WebSSH-DataTableResize",
                                                    )
                                                ) {
                                                    return;
                                                }
                                                header.column.toggleSorting();
                                            }}
                                        >
                                            <div className="filelistTableColumnHeader">
                                                <span className="filelistTableColumnTitle">
                                                    {flexRender(
                                                        header.column.columnDef
                                                            .header,
                                                        header.getContext(),
                                                    )}
                                                </span>
                                                <span
                                                    className="filelistTableColumnSorter"
                                                    aria-hidden="true"
                                                >
                                                    <CaretUpOutlined
                                                        className={
                                                            sorted === "asc"
                                                                ? "filelistTableColumnSorterIconActive"
                                                                : ""
                                                        }
                                                    />
                                                    <CaretDownOutlined
                                                        className={
                                                            sorted === "desc"
                                                                ? "filelistTableColumnSorterIconActive"
                                                                : ""
                                                        }
                                                    />
                                                </span>
                                            </div>
                                            <div className="filelistTableThBorderRight" />
                                            <ResizeLine
                                                direction="v"
                                                className="WebSSH-DataTableResize"
                                                onMoved={() => {
                                                    delete resizeOrigin.current[
                                                        header.column.id
                                                    ];
                                                }}
                                                onMove={({ moveX }) => {
                                                    resizeOrigin.current[
                                                        header.column.id
                                                    ] ??=
                                                        columnWidths[
                                                            header.column.id
                                                        ] ??
                                                        column?.width ??
                                                        160;
                                                    setColumnWidths(
                                                        (previous) => ({
                                                            ...previous,
                                                            [header.column.id]:
                                                                Math.max(
                                                                    column?.minWidth ??
                                                                        48,
                                                                    resizeOrigin
                                                                        .current[
                                                                        header
                                                                            .column
                                                                            .id
                                                                    ] + moveX,
                                                                ),
                                                        }),
                                                    );
                                                }}
                                            />
                                        </th>
                                    );
                                })}
                        </tr>
                    </thead>
                </table>
            </div>
            {rows.length === 0 ? (
                <div className="WebSSH-DataTableEmpty">{emptyContent}</div>
            ) : (
                <div
                    className="WebSSH-DataTableBody"
                    style={{ height: rows.length * rowHeight }}
                    onMouseDown={(event) => {
                        if ((event.target as HTMLElement).closest("tbody tr"))
                            return;
                        dragStartIndex.current = Math.floor(
                            (event.clientY -
                                event.currentTarget.getBoundingClientRect()
                                    .top) /
                                rowHeight,
                        );
                    }}
                    onMouseUp={() => {
                        dragStartIndex.current = null;
                    }}
                    onMouseMove={(event) => {
                        if (
                            dragStartIndex.current === null ||
                            event.buttons !== 1
                        )
                            return;
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
                            if (rows[i]?.getCanSelect())
                                next[rows[i].id] = true;
                        }
                        setRowSelection(next);
                    }}
                >
                    <table
                        className="filelistTable WebSSH-DataTableVirtualTable"
                        style={{
                            width: tableWidth,
                            top: virtual ? startIndex * rowHeight : 0,
                        }}
                    >
                        <colgroup>
                            {multiple && <col style={{ width: 26 }} />}
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
                            {visibleRows.map((row, visibleIndex) => {
                                const original = row.original;
                                const disabled = !row.getCanSelect();
                                const sortedIndex = startIndex + visibleIndex;
                                return (
                                    <tr
                                        key={row.id}
                                        className={classNames({
                                            filelistTableTrActive:
                                                row.getIsSelected(),
                                            filelistTableTrDisabled: disabled,
                                            filelistTableTrActiveBorder:
                                                activeId === row.id,
                                        })}
                                        style={{ height: rowHeight }}
                                        aria-disabled={disabled}
                                        draggable={draggable}
                                        onClick={(event) => {
                                            const index = sortedIndex;
                                            const additive =
                                                event.ctrlKey || event.metaKey;
                                            const range = event.shiftKey;
                                            if (
                                                range &&
                                                selectionAnchor.current === null
                                            )
                                                selectionAnchor.current =
                                                    row.id;
                                            if (row.getCanSelect())
                                                selectIndex(
                                                    index,
                                                    additive,
                                                    range,
                                                );
                                            onRowClick?.(original);
                                        }}
                                        onDoubleClick={(event) =>
                                            onRowDoubleClick?.(
                                                original,
                                                event.nativeEvent,
                                            )
                                        }
                                        onContextMenu={(event) => {
                                            event.preventDefault();
                                            const selected = selectedRows.some(
                                                (item) => item.id === row.id,
                                            )
                                                ? selectedRows.map(
                                                      (item) => item.original,
                                                  )
                                                : [original];
                                            if (
                                                !selectedRows.some(
                                                    (item) =>
                                                        item.id === row.id,
                                                )
                                            ) {
                                                setRowSelection({
                                                    [row.id]: true,
                                                });
                                            }
                                            selectionAnchor.current = row.id;
                                            onContextMenu?.(
                                                selected,
                                                event.nativeEvent,
                                            );
                                        }}
                                        onDragStart={(event) => {
                                            const selected =
                                                selectedRows.length &&
                                                row.getIsSelected()
                                                    ? selectedRows.map(
                                                          (item) =>
                                                              item.original,
                                                      )
                                                    : [original];
                                            dragRows.current = selected;
                                            event.dataTransfer.effectAllowed =
                                                "copyMove";
                                            event.dataTransfer.setData(
                                                "application/x-webssh-table-rows",
                                                JSON.stringify(
                                                    selected.map((item) =>
                                                        getRowId(
                                                            item,
                                                            data.indexOf(item),
                                                        ),
                                                    ),
                                                ),
                                            );
                                        }}
                                        onDragEnd={() => {
                                            dragRows.current = null;
                                        }}
                                        onDragOver={(event) =>
                                            event.preventDefault()
                                        }
                                        onDrop={(event) =>
                                            handleDrop(original, event)
                                        }
                                    >
                                        {multiple && (
                                            <td className="filelistTableCellColCheckbox">
                                                <input
                                                    type="checkbox"
                                                    checked={row.getIsSelected()}
                                                    disabled={disabled}
                                                    aria-label={`Select row ${sortedIndex + 1}`}
                                                    onClick={(event) =>
                                                        event.stopPropagation()
                                                    }
                                                    onChange={(event) => {
                                                        row.toggleSelected(
                                                            event.target
                                                                .checked,
                                                        );
                                                        selectionAnchor.current =
                                                            row.id;
                                                        setActiveId(row.id);
                                                    }}
                                                />
                                            </td>
                                        )}
                                        {row
                                            .getAllCells()
                                            .map((cell, cellIndex) => {
                                                const column =
                                                    columns[cellIndex];
                                                return (
                                                    <td
                                                        key={cell.id}
                                                        className={
                                                            column?.className
                                                        }
                                                        style={{
                                                            textAlign:
                                                                column?.align ??
                                                                "left",
                                                        }}
                                                    >
                                                        {flexRender(
                                                            cell.column
                                                                .columnDef.cell,
                                                            cell.getContext(),
                                                        )}
                                                    </td>
                                                );
                                            })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export default memo(DataTable) as typeof DataTable;
