import {
    CaretDownOutlined,
    CaretRightOutlined,
    CaretUpOutlined,
} from "@ant-design/icons";
import {
    type Cell,
    type ColumnDef,
    createCoreRowModel,
    createExpandedRowModel,
    createSortedRowModel,
    type ExpandedState,
    flexRender,
    type Row,
    type RowData,
    type RowSelectionState,
    rowExpandingFeature,
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
    rowExpandingFeature,
    rowSortingFeature,
    coreRowModel: createCoreRowModel(),
    sortedRowModel: createSortedRowModel(),
    expandedRowModel: createExpandedRowModel(),
});
const ROW_OVERSCAN = 10;
const VIRTUAL_WINDOW_STEP = 8;
type DropPosition = "before" | "after";

function supportsNativeDragAndDrop() {
    if (typeof window === "undefined" || typeof document === "undefined") {
        return false;
    }
    const userAgent = navigator.userAgent;
    // Some WebKit webviews expose the complete drag-and-drop API but never
    // dispatch dragenter/dragover/drop for HTML elements. Their UA contains
    // AppleWebKit without the browser token added by Safari or Chromium.
    const isWebKitWebView =
        /AppleWebKit\//i.test(userAgent) &&
        !/(Safari|Chrome|CriOS|Edg|OPR|Firefox)\//i.test(userAgent);
    if (isWebKitWebView) return false;
    const probe = document.createElement("div");
    return (
        "draggable" in probe &&
        "ondragstart" in probe &&
        "ondragover" in probe &&
        "ondrop" in probe &&
        typeof window.DragEvent === "function" &&
        typeof window.DataTransfer === "function"
    );
}

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
    dropPosition: "before" | "after";
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

function DataTable<TData extends RowData>({
    className,
    data,
    columns,
    getRowId,
    rowHeight = 24,
    selectable = true,
    multiple = true,
    virtual = true,
    draggable = false,
    canDropRow,
    showDropIndicator,
    loading = false,
    emptyContent = "No data",
    canSelectRow,
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
    getSubRows,
    defaultExpanded = false,
    expandIcon,
}: DataTableProps<TData>) {
    const rootRef = useRef<HTMLDivElement>(null);
    const [sorting, setSorting] = useState<SortingState>([]);
    const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
    const [expanded, setExpanded] = useState<ExpandedState>(
        defaultExpanded ? true : {},
    );
    const [activeId, setActiveId] = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);
    const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
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
    const pointerDragEnabled = draggable && !supportsNativeDragAndDrop();
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
        getSubRows,
        state: { sorting, rowSelection, expanded },
        onSortingChange: setSorting,
        onRowSelectionChange: setRowSelection,
        onExpandedChange: setExpanded,
        autoResetExpanded: false,
        enableRowSelection: (row) =>
            selectable && (canSelectRow?.(row.original) ?? true),
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
    const selectedRowsRef = useRef<Row<typeof features, TData>[]>(selectedRows);
    selectedRowsRef.current = selectedRows;
    const visibleCount = virtual
        ? Math.ceil(viewportHeight / rowHeight) + ROW_OVERSCAN * 2
        : rows.length;
    const startIndex = virtual
        ? getVirtualStartIndex(bodyScrollTop, rowHeight)
        : 0;
    const visibleRows = useMemo(
        () => rows.slice(startIndex, startIndex + visibleCount),
        [rows, startIndex, visibleCount],
    );
    const tableWidth = columns.reduce(
        (width, column) =>
            width + (columnWidths[column.id] ?? column.width ?? 160),
        multiple && selectable ? 26 : 0,
    );

    useEffect(() => {
        if (!selectable) {
            setRowSelection((previous) =>
                Object.keys(previous).length > 0 ? {} : previous,
            );
            selectionAnchor.current = null;
            setActiveId(null);
            return;
        }
        setRowSelection((previous) => {
            const ids = new Set<string>();
            const collectIds = (items: ReadonlyArray<TData>) => {
                items.forEach((item, index) => {
                    ids.add(getRowId(item, index));
                    const children = getSubRows?.(item, index);
                    if (children) collectIds(children);
                });
            };
            collectIds(data);
            const next = Object.fromEntries(
                Object.entries(previous).filter(([id]) => ids.has(id)),
            );
            return Object.keys(next).length === Object.keys(previous).length
                ? previous
                : next;
        });
    }, [data, getRowId, getSubRows, selectable]);

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
            if (!selectable) return;
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
                setRowSelection((previous) => {
                    const next: RowSelectionState = additive
                        ? { ...previous }
                        : {};
                    for (let i = from; i <= to; i += 1) {
                        if (rows[i].getCanSelect()) next[rows[i].id] = true;
                    }
                    return next;
                });
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
        [multiple, rows, selectable],
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
            if (!selectable || !multiple) return;
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

    const finishDrop = useCallback(
        (
            target: TData | null,
            sourceRows: TData[],
            position: DropPosition,
            event: DragEvent,
            files: File[] = [],
        ) => {
            onDrop?.({
                rows: sourceRows,
                files,
                target,
                dropPosition: position,
                event,
            });
            dragRows.current = null;
            setDropTargetId(null);
            setDropPosition(null);
        },
        [onDrop],
    );

    const handleDrop = useCallback(
        (
            target: TData | null,
            event: React.DragEvent | DragEvent,
            position: DropPosition = "after",
        ) => {
            const dataTransfer = event.dataTransfer;
            if (!dataTransfer) return;
            console.log("[drag-debug] DataTable handleDrop", {
                targetId: target
                    ? (target as { id?: string | number }).id
                    : null,
                position,
                types: Array.from(dataTransfer.types),
                memoryRows: dragRows.current?.length ?? 0,
            });
            event.preventDefault();
            event.stopPropagation();
            const nativeEvent =
                "nativeEvent" in event ? event.nativeEvent : event;
            let sourceRows = dragRows.current;
            if (!sourceRows) {
                const serialized = dataTransfer.getData(
                    "application/x-webssh-table-rows",
                );
                if (serialized) {
                    try {
                        const ids = new Set(JSON.parse(serialized) as string[]);
                        console.log("[drag-debug] DataTable serialized rows", [
                            ...ids,
                        ]);
                        sourceRows = rows
                            .filter((row) => ids.has(row.id))
                            .map((row) => row.original);
                    } catch (error) {
                        console.log(
                            "[drag-debug] DataTable serialized rows parse failed",
                            error,
                        );
                        sourceRows = [];
                    }
                }
            }
            console.log("[drag-debug] DataTable resolved drop rows", {
                count: sourceRows?.length ?? 0,
                rowIds: sourceRows?.map(
                    (item) => (item as { id?: string | number }).id,
                ),
            });
            finishDrop(
                target,
                sourceRows ?? [],
                position,
                nativeEvent,
                Array.from(dataTransfer.files),
            );
        },
        [finishDrop, rows],
    );

    useEffect(() => {
        if (!pointerDragEnabled) return;
        const root = rootRef.current;
        if (!root) return;

        let pointerDrag: {
            pointerId: number;
            startX: number;
            startY: number;
            sourceRows: TData[];
            active: boolean;
            target: Row<typeof features, TData> | null;
            position: DropPosition | null;
            overRoot: boolean;
        } | null = null;
        let suppressClick = false;

        const getRowElement = (target: EventTarget | null) => {
            if (!(target instanceof Element)) return null;
            return target.closest<HTMLElement>("tbody tr[data-row-id]");
        };
        const getRow = (
            rowElement: HTMLElement,
        ): Row<typeof features, TData> | null =>
            rows.find((row) => row.id === rowElement.dataset.rowId) ?? null;
        const getPosition = (event: PointerEvent, rowElement: HTMLElement) => {
            const bounds = rowElement.getBoundingClientRect();
            return event.clientY < bounds.top + bounds.height / 2
                ? "before"
                : "after";
        };

        const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0) return;
            const target = event.target;
            if (
                target instanceof Element &&
                target.closest("button, input, a")
            ) {
                return;
            }
            const rowElement = getRowElement(target);
            if (!rowElement) return;
            const row = getRow(rowElement);
            if (!row) return;
            pointerDrag = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                sourceRows: currentSelectedRowsForDrag(
                    selectedRowsRef.current,
                    row,
                    row.original,
                ),
                active: false,
                target: null,
                position: null,
                overRoot: false,
            };
        };
        const onPointerMove = (event: PointerEvent) => {
            if (!pointerDrag || pointerDrag.pointerId !== event.pointerId)
                return;
            if (!pointerDrag.active) {
                const distance = Math.hypot(
                    event.clientX - pointerDrag.startX,
                    event.clientY - pointerDrag.startY,
                );
                if (distance < 5) return;
                pointerDrag.active = true;
                dragRows.current = pointerDrag.sourceRows;
                document.body.dataset.websshTableDragging = "true";
                console.log("[drag-debug] DataTable pointerDragStart", {
                    rowIds: pointerDrag.sourceRows.map(
                        (item) => (item as { id?: string | number }).id,
                    ),
                });
                setDragging(true);
            }
            event.preventDefault();
            event.stopPropagation();
            const rowElement = getRowElement(
                document.elementFromPoint(event.clientX, event.clientY),
            );
            if (!rowElement) {
                pointerDrag.target = null;
                pointerDrag.position = "after";
                const pointTarget = document.elementFromPoint(
                    event.clientX,
                    event.clientY,
                );
                pointerDrag.overRoot =
                    pointTarget instanceof Node && root.contains(pointTarget);
                setDropTargetId(null);
                setDropPosition(null);
                return;
            }
            const row = getRow(rowElement);
            if (!row) return;
            pointerDrag.target = row;
            pointerDrag.position = getPosition(event, rowElement);
            pointerDrag.overRoot = true;
            setDropTargetId(row.id);
            setDropPosition(pointerDrag.position);
        };
        const onPointerUp = (event: PointerEvent) => {
            if (!pointerDrag || pointerDrag.pointerId !== event.pointerId)
                return;
            const currentDrag = pointerDrag;
            pointerDrag = null;
            if (currentDrag.active) {
                suppressClick = true;
                const canDrop = currentDrag.target
                    ? (canDropRow?.(currentDrag.target.original) ?? true)
                    : currentDrag.overRoot;
                if (canDrop && currentDrag.position) {
                    console.log("[drag-debug] DataTable pointer drop", {
                        targetId: currentDrag.target?.id ?? null,
                        position: currentDrag.position,
                    });
                    finishDrop(
                        currentDrag.target?.original ?? null,
                        currentDrag.sourceRows,
                        currentDrag.position,
                        event as unknown as DragEvent,
                    );
                } else {
                    dragRows.current = null;
                    setDropTargetId(null);
                    setDropPosition(null);
                }
                delete document.body.dataset.websshTableDragging;
                setDragging(false);
            }
        };
        const onPointerCancel = (event: PointerEvent) => {
            if (!pointerDrag || pointerDrag.pointerId !== event.pointerId)
                return;
            pointerDrag = null;
            dragRows.current = null;
            delete document.body.dataset.websshTableDragging;
            setDragging(false);
            setDropTargetId(null);
            setDropPosition(null);
        };
        const onClick = (event: MouseEvent) => {
            if (!suppressClick) return;
            suppressClick = false;
            event.preventDefault();
            event.stopPropagation();
        };

        root.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("pointermove", onPointerMove, true);
        document.addEventListener("pointerup", onPointerUp, true);
        document.addEventListener("pointercancel", onPointerCancel, true);
        root.addEventListener("click", onClick, true);
        return () => {
            root.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("pointermove", onPointerMove, true);
            document.removeEventListener("pointerup", onPointerUp, true);
            document.removeEventListener(
                "pointercancel",
                onPointerCancel,
                true,
            );
            root.removeEventListener("click", onClick, true);
        };
    }, [canDropRow, finishDrop, pointerDragEnabled, rows]);

    return (
        <div
            ref={rootRef}
            className={classNames("WebSSH-DataTable", className, {
                "WebSSH-DataTableLoading": loading,
                "WebSSH-DataTableTextSelectable": !selectable,
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
            onDragOverCapture={(event) => {
                console.log(
                    "[drag-debug] DataTable root dragOverCapture",
                    event.target,
                );
                const target = event.target as HTMLElement;
                if (target.closest("tbody tr")) return;
                console.log("[drag-debug] DataTable root dragOverCapture", {
                    tagName: target.tagName,
                    className: target.className,
                    types: Array.from(event.dataTransfer.types),
                });
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                setDropTargetId(null);
                setDropPosition(null);
            }}
            onDropCapture={(event) => {
                if ((event.target as HTMLElement).closest("tbody tr")) return;
                handleDrop(null, event);
            }}
        >
            <div
                className="WebSSH-DataTableHeader"
                style={{ width: tableWidth }}
            >
                <table
                    className="WebSSH-DataTableTable"
                    style={{ width: tableWidth }}
                >
                    <colgroup>
                        {multiple && selectable && (
                            <col style={{ width: 26 }} />
                        )}
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
                            {multiple && selectable && (
                                <th className="WebSSH-DataTableCellColCheckbox">
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
                                            className={classNames(
                                                column?.className,
                                                {
                                                    "WebSSH-DataTableSortable":
                                                        header.column.getCanSort(),
                                                },
                                            )}
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
                                                    !header.column.getCanSort()
                                                ) {
                                                    return;
                                                }
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
                                            <div className="WebSSH-DataTableColumnHeader">
                                                <span className="WebSSH-DataTableColumnTitle">
                                                    {flexRender(
                                                        header.column.columnDef
                                                            .header,
                                                        header.getContext(),
                                                    )}
                                                </span>
                                                {header.column.getCanSort() && (
                                                    <span
                                                        className="WebSSH-DataTableColumnSorter"
                                                        aria-hidden="true"
                                                    >
                                                        <CaretUpOutlined
                                                            className={
                                                                sorted === "asc"
                                                                    ? "WebSSH-DataTableColumnSorterIconActive"
                                                                    : ""
                                                            }
                                                        />
                                                        <CaretDownOutlined
                                                            className={
                                                                sorted ===
                                                                "desc"
                                                                    ? "WebSSH-DataTableColumnSorterIconActive"
                                                                    : ""
                                                            }
                                                        />
                                                    </span>
                                                )}
                                            </div>
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
                <MemoDataTableBody<TData>
                    rows={rows}
                    visibleRows={visibleRows}
                    startIndex={startIndex}
                    rowHeight={rowHeight}
                    tableWidth={tableWidth}
                    virtual={virtual}
                    columns={columns}
                    columnWidths={columnWidths}
                    selectable={selectable}
                    multiple={multiple}
                    draggable={draggable && !pointerDragEnabled}
                    canDropRow={canDropRow}
                    showDropIndicator={showDropIndicator}
                    dragging={dragging}
                    dropTargetId={dropTargetId}
                    dropPosition={dropPosition}
                    getRowId={getRowId}
                    data={data}
                    getSubRows={getSubRows}
                    expandIcon={expandIcon}
                    activeId={activeId}
                    rowSelection={rowSelection}
                    selectionAnchor={selectionAnchor}
                    selectedRows={selectedRowsRef}
                    setRowSelection={setRowSelection}
                    setActiveId={setActiveId}
                    setDragging={setDragging}
                    setDropTargetId={setDropTargetId}
                    setDropPosition={setDropPosition}
                    dragRows={dragRows}
                    dragStartIndex={dragStartIndex}
                    selectIndex={selectIndex}
                    onRowClick={onRowClick}
                    onRowDoubleClick={onRowDoubleClick}
                    onContextMenu={onContextMenu}
                    onDrop={handleDrop}
                />
            )}
        </div>
    );
}

interface DataTableBodyProps<TData extends RowData> {
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
        event: React.DragEvent,
        dropPosition: "before" | "after",
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
                        <MemoDataTableRow<TData>
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

const MemoDataTableBody = memo(DataTableBody) as typeof DataTableBody;

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
        event: React.DragEvent,
        dropPosition: "before" | "after",
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
                if (range && selectionAnchor.current === null)
                    selectionAnchor.current = row.id;
                if (row.getCanSelect()) selectIndex(rowIndex, additive, range);
                onRowClick?.(original);
            }}
            onDoubleClick={(event) =>
                onRowDoubleClick?.(original, event.nativeEvent)
            }
            onContextMenu={(event) => {
                event.preventDefault();
                const currentSelectedRows = selectedRows.current;
                const selected =
                    row.getCanSelect() &&
                    currentSelectedRows.some((item) => item.id === row.id);
                const selectedForContext = selected
                    ? currentSelectedRows.map((item) => item.original)
                    : [original];
                if (row.getCanSelect() && !selected) {
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
                // WKWebView can reject custom drag formats. The in-memory
                // source is used for same-page drops, while text/plain keeps
                // the native drag operation alive as a fallback.
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
                    // Ignore unsupported custom formats in WebKit.
                }
                event.dataTransfer.setData("text/plain", rowIds);
                console.log("[drag-debug] DataTable dragStart", {
                    rowId: getRowId(original, data.indexOf(original)),
                    selectedCount: selectedForDrag.length,
                    rowIds,
                    types: Array.from(event.dataTransfer.types),
                });
                setDragging(true);
            }}
            onDragEnd={() => {
                console.log("[drag-debug] DataTable dragEnd");
                dragRows.current = null;
                delete document.body.dataset.websshTableDragging;
                setDragging(false);
                setDropTargetId(null);
                setDropPosition(null);
            }}
            onDragOver={(event) => {
                console.log("[drag-debug] DataTable onDragOver");
                const bounds = event.currentTarget.getBoundingClientRect();
                const nextDropPosition =
                    event.clientY < bounds.top + bounds.height / 2
                        ? "before"
                        : "after";
                setDropTargetId(row.id);
                setDropPosition(nextDropPosition);
                if (!canDrop) {
                    console.log("[drag-debug] DataTable dragOver rejected", {
                        rowId: getRowId(original, data.indexOf(original)),
                        position: nextDropPosition,
                    });
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
                console.log("[drag-debug] DataTable row drop", {
                    rowId: getRowId(original, data.indexOf(original)),
                    canDrop,
                });
                if (!canDrop) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                const bounds = event.currentTarget.getBoundingClientRect();
                const dropPosition =
                    event.clientY < bounds.top + bounds.height / 2
                        ? "before"
                        : "after";
                onDrop(original, event, dropPosition);
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

function currentSelectedRowsForDrag<TData extends RowData>(
    selectedRows: Row<typeof features, TData>[],
    row: Row<typeof features, TData>,
    original: TData,
) {
    return selectedRows.length && row.getIsSelected()
        ? selectedRows.map((item) => item.original)
        : [original];
}

const MemoDataTableRow = memo(DataTableRow) as typeof DataTableRow;

export default memo(DataTable) as typeof DataTable;
