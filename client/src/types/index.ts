import type { ISftpFile } from "@/api/sftp";

/**
 * 文件属性模型 file
 */
export interface IFile extends ISftpFile {
    /** 文件url */
    url: string;
    /** 用于排序的名称，将name属性转换为小写 */
    sortName?: string;
}
