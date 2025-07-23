import downloadFile from "./downloadFile";

export default async function download(option: { fileUri: string }) {
    const abortController = new AbortController();
    let _sumLoaded = 0;
    await downloadFile({
        ...option,
        signal: abortController.signal,
        onFlow: (newLoaded) => {
            _sumLoaded += newLoaded;
        },
        onProgress: (progress) => {
            console.debug("Transfer/upload onProgress", progress);
        },
    });

    // TODO: 状态控制，重试，终止
}
