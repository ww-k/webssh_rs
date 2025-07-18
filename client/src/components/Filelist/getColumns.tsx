import moment from "moment";

import flowFormatter from "@/helpers/flowFormatter";

import type { IFile } from "@/types";
import type { IFileListColumn } from "./types";

const fileIcon = `<span role="img" aria-label="file" class="anticon anticon-file"><svg viewBox="64 64 896 896" focusable="false" data-icon="file" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M854.6 288.6L639.4 73.4c-6-6-14.1-9.4-22.6-9.4H192c-17.7 0-32 14.3-32 32v832c0 17.7 14.3 32 32 32h640c17.7 0 32-14.3 32-32V311.3c0-8.5-3.4-16.7-9.4-22.7zM790.2 326H602V137.8L790.2 326zm1.8 562H232V136h302v216a42 42 0 0042 42h216v494z"></path></svg></span>`;

const fileIconMap: Record<IFile["type"], string> = {
    d: `<span role="img" aria-label="folder" class="anticon anticon-folder"><svg viewBox="64 64 896 896" focusable="false" data-icon="folder" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M880 298.4H521L403.7 186.2a8.15 8.15 0 00-5.5-2.2H144c-17.7 0-32 14.3-32 32v592c0 17.7 14.3 32 32 32h736c17.7 0 32-14.3 32-32V330.4c0-17.7-14.3-32-32-32zM840 768H184V256h188.5l119.6 114.4H840V768z" fill="#1677ff"></path><path d="M372.5 256H184v512h656V370.4H492.1z" fill="#e6f4ff"></path></svg></span>`,
    f: fileIcon,
    l: fileIcon,
    "?": fileIcon,
};

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
                `${fileIconMap[record.type] || fileIcon}<span title="${record.name}" draggable="false">${record.name}</span>`,
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
                    ? `<span>${moment(record.mtime).format("YYYY-MM-DD HH:mm:ss")}</span>`
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
                record.type === "d"
                    ? ""
                    : `<span>${flowFormatter(value as number)}</span>`,
        },
    ];

    return columns;
}
