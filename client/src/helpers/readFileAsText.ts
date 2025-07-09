export default function readFileAsText(
    file: File,
    maxFileSize?: number,
): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        if (typeof maxFileSize === "number" && file.size > maxFileSize) {
            reject(new Error(`File size exceeds limit ${maxFileSize} bytes`));
            return;
        }

        const fileReader = new FileReader();

        fileReader.onload = () => {
            resolve(fileReader.result as string);
        };

        fileReader.onerror = (err) => {
            console.error("readFileAsText error", err);
            reject(new Error("FileReader error"));
        };

        fileReader.readAsText(file);
    });
}
