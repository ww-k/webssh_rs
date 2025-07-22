import upload from "./upload";

class TransferService {
    upload(option: { file: File; fileUri: string }) {
        return upload(option);
    }
}

export default new TransferService();
