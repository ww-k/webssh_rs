import uploadFile from "./uploadFle";

export default function upload(option: { file: File; fileUri: string }) {
    const abortController = new AbortController();
    let _sumLoaded = 0;
    uploadFile({
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
