import { useCallback, useMemo, useState } from "react";

import DataTable, { type DataTableDropEvent } from "@/components/DataTable";

import "./index.css";

interface DemoRecord {
    id: string;
    name: string;
    category: string;
    size: number;
    modified: string;
    status: "Ready" | "Processing" | "Archived";
}

const categories = ["Documents", "Images", "Archives", "Projects", "Logs"];
const statuses: DemoRecord["status"][] = ["Ready", "Processing", "Archived"];
const demoData: DemoRecord[] = Array.from({ length: 10_000 }, (_, index) => ({
    id: `record-${String(index + 1).padStart(5, "0")}`,
    name: `workspace-${String(index + 1).padStart(5, "0")}.${index % 4 === 0 ? "zip" : "dat"}`,
    category: categories[index % categories.length],
    size: (index * 7919) % 8_000_000,
    modified: new Date(
        Date.UTC(2025, index % 12, (index % 27) + 1, index % 24, index % 60),
    )
        .toISOString()
        .slice(0, 16)
        .replace("T", " "),
    status: statuses[index % statuses.length],
}));

function formatBytes(value: number) {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DataTableDemo() {
    const [selected, setSelected] = useState<DemoRecord[]>([]);
    const getRowId = useCallback((row: DemoRecord) => row.id, []);
    const handleRowDoubleClick = useCallback((row: DemoRecord) => {
        console.info("Open row", row.id);
    }, []);
    const handleContextMenu = useCallback((rows: DemoRecord[] | null) => {
        console.info("Context menu rows", rows?.length ?? 0);
    }, []);
    const handleDrop = useCallback((event: DataTableDropEvent<DemoRecord>) => {
        console.info(
            "Dropped",
            event.rows.length,
            "rows and",
            event.files.length,
            "files",
        );
    }, []);
    const columns = useMemo(
        () => [
            {
                id: "name",
                header: "Name",
                accessor: (row: DemoRecord) => row.name,
                width: 360,
                sortable: true,
                className: "DataTableDemoName",
            },
            {
                id: "category",
                header: "Category",
                accessor: (row: DemoRecord) => row.category,
                width: 170,
                sortable: true,
            },
            {
                id: "size",
                header: "Size",
                accessor: (row: DemoRecord) => row.size,
                width: 120,
                sortable: true,
                align: "right" as const,
                cell: (value: unknown) => formatBytes(value as number),
            },
            {
                id: "modified",
                header: "Modified",
                accessor: (row: DemoRecord) => row.modified,
                width: 180,
                sortable: true,
            },
            {
                id: "status",
                header: "Status",
                accessor: (row: DemoRecord) => row.status,
                width: 140,
                sortable: true,
                cell: (value: unknown) => (
                    <span
                        className={`DataTableDemoStatus DataTableDemoStatus-${String(value).toLowerCase()}`}
                    >
                        {String(value)}
                    </span>
                ),
            },
        ],
        [],
    );

    return (
        <main className="WebSSH-MenuPage DataTableDemo">
            <header className="DataTableDemoToolbar">
                <div>
                    <strong>Custom Table</strong>
                    <span>{demoData.length.toLocaleString()} rows</span>
                </div>
                <span>{selected.length.toLocaleString()} selected</span>
            </header>
            <section className="WebSSH-MenuPageContent DataTableDemoContent">
                <DataTable
                    data={demoData}
                    columns={columns}
                    getRowId={getRowId}
                    onSelectionChange={setSelected}
                    onRowDoubleClick={handleRowDoubleClick}
                    onContextMenu={handleContextMenu}
                    onDrop={handleDrop}
                    emptyContent="No records"
                />
            </section>
        </main>
    );
}
