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
            // @ts-expect-error
            typeof message.code === "string" &&
            // @ts-expect-error
            typeof message.message === "string"
        ) {
            // IError
            // @ts-expect-error
            this.code = message.code;
            // @ts-expect-error
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
        // @ts-expect-error
        if (typeof Error.captureStackTrace === "function") {
            // @ts-expect-error
            Error.captureStackTrace(this, TransferError);
        }
    }
}
