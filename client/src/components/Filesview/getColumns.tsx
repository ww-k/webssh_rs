import moment from "moment";

import flowFormatter from "@/helpers/flowFormatter";

import type { IFileListColumn } from "../Filelist/types";

export default function getColumns() {
    const columns: IFileListColumn[] = [
        {
            title: "文件名",
            className: "filelistTableCellColName",
            dataIndex: "name",
            sortKey: "sortName",
            width: 200,
            sorter: true,
            display: true,
            render: (_, record) =>
                `<span title="${record.name}" draggable="false">${record.name}</span>`,
        },
        {
            title: "最近修改时间",
            className: "filelistTableCellColMtime",
            dataIndex: "mtime",
            width: 145,
            sorter: true,
            display: true,
            render: (_, record) =>
                record.mtime
                    ? moment(record.mtime).format("YYYY-MM-DD HH:mm:ss")
                    : "",
        },
        {
            title: "文件大小",
            className: "filelistTableCellColSize",
            dataIndex: "size",
            sortKey: "size",
            width: 90,
            align: "right",
            sorter: true,
            display: true,
            render: (value, record) =>
                record.type === "d" ? "" : flowFormatter(value as number),
        },
    ];

    return columns;
}
