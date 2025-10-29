import axios from "axios";

axios.interceptors.response.use(
    (response) => response,
    (err) => {
        if (axios.isCancel(err) === true) {
            // 主动取消的请求, 抛出原异常
            // @ts-expect-error
            err.code = "Aborted";
            throw err;
        }

        if (
            err.response &&
            err.response.status === 500 &&
            err.response.data instanceof Blob
        ) {
            return err.response.data.text().then((playload: string) => {
                const resError = JSON.parse(playload);
                err.response.data = resError;
                err.code = resError.code;
                err.message = resError.msg;
                throw err;
            });
        }

        if (err.message === "Network Error") {
            err.code = "NetworkError";
        } else if (
            err.response &&
            err.response.data &&
            err.response.data.code !== undefined
        ) {
            err.code = err.response.data.code;
            err.message = err.response.data.msg || err.message;
        } else if (err.response && err.response.status === 401) {
            err.code = 401;
        } else {
            err.code = err.code || "UnknownNetworkError";
        }

        throw err;
    },
);

export * from "./sftp";
export * from "./target";
