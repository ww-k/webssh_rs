import { isAxiosError } from "axios";

export default class TransferError extends Error {
    code: string;
    constructor(message: unknown) {
        super();
        this.name = "TransferError";
        this.code = "";
        if (
            typeof message === "object" &&
            message &&
            // @ts-ignore
            typeof message.code === "string" &&
            // @ts-ignore
            message.message
        ) {
            // IError
            // @ts-ignore
            this.code = message.code;
            // @ts-ignore
            this.message = message.message;
        } else if (isAxiosError(message)) {
            if (
                message.response &&
                message.response.status === 500 &&
                message.code
            ) {
                this.code = `http_api_res_${message.code}`;
                this.message = message.message;
            } else {
                this.code = message.code || "UnknownNetworkError";
                this.message = message.message;
            }
        } else if (typeof message === "string") {
            this.message = message;
        } else if (message && typeof message.toString === "function") {
            this.message = message.toString();
        } else {
            this.message = "unknown error";
        }
        // @ts-ignore
        if (typeof Error.captureStackTrace === "function") {
            // @ts-ignore
            Error.captureStackTrace(this, TransferError);
        }
    }
}
