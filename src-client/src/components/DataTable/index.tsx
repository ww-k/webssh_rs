import {
    type ColumnDef,
    type ExpandedState,
    type Row,
    type RowData,
    type RowSelectionState,
    type SortingState,
    useTable,
} from "@tanstack/react-table";
import classNames from "clsx";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import DataTableBody from "./DataTableBody";
import DataTableHeader from "./DataTableHeader";
import { features } from "./table";
import {
    currentSelectedRowsForDrag,
    getVirtualStartIndex,
    ROW_OVERSCAN,
    supportsNativeDragAndDrop,
} from "./utils";

import type { DataTableProps, DropPosition } from "./types";
import "./index.css";

export type {
    DataTableColumn,
    DataTableDropEvent,
    DataTableProps,
} from "./types";

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
            <DataTableHeader<TData>
                tableWidth={tableWidth}
                columns={columns}
                columnWidths={columnWidths}
                multiple={multiple}
                selectable={selectable}
                headers={table.getHeaderGroups()[0]?.headers ?? []}
                selectableRows={selectableRows}
                selectedRows={selectedRows}
                setRowSelection={setRowSelection}
                setActiveId={setActiveId}
                resizeOrigin={resizeOrigin}
                setColumnWidths={setColumnWidths}
            />
            {rows.length === 0 ? (
                <div className="WebSSH-DataTableEmpty">{emptyContent}</div>
            ) : (
                <DataTableBody<TData>
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

export default memo(DataTable) as typeof DataTable;
