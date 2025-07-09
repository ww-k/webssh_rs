var fileEl;
/**
 * 打开原生的文件选择器
 * @param {object} [option]
 * @param {boolean} [option.directory=false] 是否选择目录, 默认为false
 * @param {boolean} [option.multiple=false] 是否多选, 默认为false
 * @returns {Promise<File[]>}
 */
export default function openNativeFileSelector(option) {
    let directory = false;
    let multiple = false;
    let defaultPath = "";
    if (option) {
        directory = !!option.directory;
        multiple = !!option.multiple;
        defaultPath =
            typeof option.defaultPath === "string" ? option.defaultPath : "";
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

        if (defaultPath) {
            fileEl.setAttribute("nwworkingdir", defaultPath);
        } else {
            fileEl.removeAttribute("nwworkingdir");
        }

        fileEl.onchange = function fileElOnChange(e) {
            const files = Array.from(e.target.files);
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
