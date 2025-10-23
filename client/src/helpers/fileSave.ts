export default function fileSave(
    data: Blob | File,
    options = { fileName: "" },
) {
    const a = document.createElement("a");
    // @ts-ignore
    a.download = options.fileName || data.name || "Untitled";
    a.href = URL.createObjectURL(data);
    a.type = data.type;

    a.addEventListener("click", () => {
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    });
    a.click();
    return null;
}
