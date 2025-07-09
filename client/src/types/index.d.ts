/**
 * 文件属性模型 file
 */
export interface IFile {
    /** 文件后缀 */
    ext: string;
    /** 文件全路径 */
    fullpath: string;
    /** 是否是目录 */
    isDir: boolean;
    /** 最后修改时间 */
    lastModified: number;
    /** 文件名 */
    name: string;
    /** 文件所在目录路径 */
    path: string;
    /** 文件大小 */
    size: number;
    /** 文件url. prn:协议的字符串 */
    url: string;
    /** 文件host */
    host: string;
    /** 用于排序的名称，将name属性转换为小写 */
    _sortName?: string;
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
    render?: (
        text: string,
        record: IFile & { type: string },
        index: number,
    ) => string;
}

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
