import { message } from "antd";
import axios from "axios";

function getErrorMessage(error: unknown): string {
    if (!error || typeof error !== "object") return "请求失败";

    const value = error as {
        message?: unknown;
        response?: { data?: unknown };
    };
    const data = value.response?.data;
    if (data && typeof data === "object") {
        const responseData = data as { message?: unknown; msg?: unknown };
        if (typeof responseData.message === "string") {
            return responseData.message;
        }
        if (typeof responseData.msg === "string") {
            return responseData.msg;
        }
    }
    return typeof value.message === "string" && value.message.trim()
        ? value.message
        : "请求失败";
}

axios.interceptors.response.use(undefined, (error) => {
    if (!axios.isCancel(error)) {
        if (
            error?.response?.data instanceof Blob &&
            typeof error.response.data.text === "function"
        ) {
            return error.response.data.text().then((payload: string) => {
                try {
                    const data = JSON.parse(payload) as {
                        message?: unknown;
                        msg?: unknown;
                    };
                    error.response.data = data;
                    if (typeof data.message === "string") {
                        error.message = data.message;
                    } else if (typeof data.msg === "string") {
                        error.message = data.msg;
                    }
                } catch {
                    // Keep Axios' original error when the response is not JSON.
                }
                message.error(getErrorMessage(error));
                return Promise.reject(error);
            });
        }
        message.error(getErrorMessage(error));
    }
    return Promise.reject(error);
});
