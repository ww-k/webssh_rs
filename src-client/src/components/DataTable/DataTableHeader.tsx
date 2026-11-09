import { CaretDownOutlined, CaretUpOutlined } from "@ant-design/icons";
import {
    flexRender,
    type Header,
    type Row,
    type RowData,
    type RowSelectionState,
} from "@tanstack/react-table";
import classNames from "clsx";

import ResizeLine from "@/components/ResizeLine";

import type { features } from "./table";
import type { DataTableColumn } from "./types";

interface DataTableHeaderProps<TData extends RowData> {
    tableWidth: number;
    columns: DataTableColumn<TData>[];
    columnWidths: Record<string, number>;
    multiple: boolean;
    selectable: boolean;
    headers: Header<typeof features, TData, unknown>[];
    selectableRows: Row<typeof features, TData>[];
    selectedRows: Row<typeof features, TData>[];
    setRowSelection: React.Dispatch<React.SetStateAction<RowSelectionState>>;
    setActiveId: React.Dispatch<React.SetStateAction<string | null>>;
    resizeOrigin: React.MutableRefObject<Record<string, number>>;
    setColumnWidths: React.Dispatch<
        React.SetStateAction<Record<string, number>>
    >;
}

export default function DataTableHeader<TData extends RowData>({
    tableWidth,
    columns,
    columnWidths,
    multiple,
    selectable,
    headers,
    selectableRows,
    selectedRows,
    setRowSelection,
    setActiveId,
    resizeOrigin,
    setColumnWidths,
}: DataTableHeaderProps<TData>) {
    return (
        <div className="WebSSH-DataTableHeader" style={{ width: tableWidth }}>
            <table
                className="WebSSH-DataTableTable"
                style={{ width: tableWidth }}
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
                                            selectableRows.forEach((row) => {
                                                next[row.id] = true;
                                            });
                                        }
                                        setRowSelection(next);
                                        setActiveId(null);
                                    }}
                                />
                            </th>
                        )}
                        {headers.map((header, index) => {
                            const column = columns[index];
                            const sorted = header.column.getIsSorted();
                            return (
                                <th
                                    key={header.id}
                                    className={classNames(column?.className, {
                                        "WebSSH-DataTableSortable":
                                            header.column.getCanSort(),
                                    })}
                                    style={{
                                        width:
                                            columnWidths[header.column.id] ??
                                            column?.width ??
                                            160,
                                        textAlign: column?.align ?? "left",
                                    }}
                                    onClick={(event) => {
                                        if (!header.column.getCanSort()) return;
                                        if (
                                            (
                                                event.target as HTMLElement
                                            ).closest(".WebSSH-DataTableResize")
                                        ) {
                                            return;
                                        }
                                        header.column.toggleSorting();
                                    }}
                                >
                                    <div className="WebSSH-DataTableColumnHeader">
                                        <span className="WebSSH-DataTableColumnTitle">
                                            {flexRender(
                                                header.column.columnDef.header,
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
                                                        sorted === "desc"
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
                                            setColumnWidths((previous) => ({
                                                ...previous,
                                                [header.column.id]: Math.max(
                                                    column?.minWidth ?? 48,
                                                    resizeOrigin.current[
                                                        header.column.id
                                                    ] + moveX,
                                                ),
                                            }));
                                        }}
                                    />
                                </th>
                            );
                        })}
                    </tr>
                </thead>
            </table>
        </div>
    );
}
