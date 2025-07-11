import type { IFile } from "@/types";

/**
 * 过滤掉同名冲突的文件
 */
export default function filesConflictFilter<T = File | IFile>(
    files: T[],
    targetList: IFile[]
): T[] {
    const noSame: T[] = [];
    const dirNamesMap: Record<string, boolean> = {};
    Array.prototype.map.call(files, (file: T) => {
        // @ts-ignore
        const relativePath = file._relativePath || file.webkitRelativePath;
        if (relativePath) {
            // 使用原生文件选择框和拖入的如果是目录，文件列表是深度遍历铺平的结果列表
            // 需要分析出拖入的目录名来进行同名冲突比较
            const dirName = relativePath.split("/")[0];
            if (dirNamesMap[dirName] === undefined) {
                dirNamesMap[dirName] = targetList.some(
                    (item) => dirName === item.name
                );
            }
            if (dirNamesMap[dirName] === false) {
                noSame.push(file);
            }
        } else {
            // @ts-ignore
            if (targetList.every((item) => file.name !== item.name)) {
                noSame.push(file);
            }
        }
    });
    const sameLen = files.length - noSame.length;
    if (sameLen > 0) {
        return noSame;
    } else {
        return files;
    }
}
