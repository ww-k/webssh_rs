import type { IViewFileStat } from "@/types";

export default function generateCopyNewName(
    list: IViewFileStat[],
    name: string,
) {
    return generateCopyNewNameLoop(list, name, 0);
}

function generateCopyNewNameLoop(
    list: IViewFileStat[],
    name: string,
    index: number,
) {
    let basename = name;
    if (index > 0) {
        const arr = name.split(".");
        if (arr.length === 1) {
            if (index > 1) {
                arr[0] = `${arr[0]}-COPY(${index})`;
            } else {
                arr[0] = `${arr[0]}-COPY`;
            }
        } else {
            if (index > 1) {
                arr[arr.length - 2] = `${arr[arr.length - 2]}-COPY(${index})`;
            } else {
                arr[arr.length - 2] = `${arr[arr.length - 2]}-COPY`;
            }
        }
        basename = arr.join(".");
    }
    var hasFile = list.some((item) => item.name === basename);
    if (hasFile) {
        basename = generateCopyNewNameLoop(list, name, index + 1);
    }
    return basename;
}
