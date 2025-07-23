import download from "./download";
import upload from "./upload";

class TransferService {
    upload(option: { file: File; fileUri: string }) {
        return upload(option);
    }
    download(option: { fileUri: string }) {
        return download(option);
    }
}

export default new TransferService();
