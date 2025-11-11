var fileEl: HTMLInputElement;
/**
 * 打开原生的文件选择器
 */
export default function openNativeFileSelector(option?: {
    /** 是否选择目录, 默认为false */
    directory?: boolean;
    /** 是否多选, 默认为false */
    multiple?: boolean;
}): Promise<File[]> {
    let directory = false;
    let multiple = false;
    if (option) {
        directory = !!option.directory;
        multiple = !!option.multiple;
    }
    return new Promise(function openNativeFileSelectorInner(resolve, reject) {
        if (!fileEl) {
            fileEl = document.createElement("input");
            fileEl.setAttribute("type", "file");
            fileEl.style.display = "none";
        }
        if (directory) {
            fileEl.setAttribute("webkitdirectory", "true");
            fileEl.setAttribute("directory", "true");
        } else {
            fileEl.removeAttribute("webkitdirectory");
            fileEl.removeAttribute("directory");
        }

        if (multiple) {
            fileEl.setAttribute("multiple", "true");
        } else {
            fileEl.removeAttribute("multiple");
        }

        fileEl.onchange = function fileElOnChange(evt) {
            // @ts-ignore
            const files: File[] = Array.from(evt.target.files);
            if (files.length > 0) {
                resolve(files);
            } else {
                reject("not select any file");
            }
        };
        fileEl.value = "";
        fileEl.click();
    });
}
