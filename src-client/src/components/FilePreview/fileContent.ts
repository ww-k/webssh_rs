import { getSftpDownload } from "@/api";

const fileContentRequests = new Map<string, Promise<string>>();

export function loadFileContent(fileUri: string) {
    const existingRequest = fileContentRequests.get(fileUri);
    if (existingRequest) return existingRequest;

    const request = getSftpDownload(fileUri).then((response) =>
        response.text(),
    );
    fileContentRequests.set(fileUri, request);

    const clearRequest = () => {
        if (fileContentRequests.get(fileUri) === request) {
            fileContentRequests.delete(fileUri);
        }
    };
    void request.then(clearRequest, clearRequest);

    return request;
}

export function parseTailEvent(event: Event): string {
    const data = (event as MessageEvent<string>).data;
    try {
        const value: unknown = JSON.parse(data);
        return typeof value === "string" ? value : data;
    } catch {
        return data;
    }
}
