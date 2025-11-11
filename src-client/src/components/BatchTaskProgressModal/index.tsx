import { WarningOutlined } from "@ant-design/icons";
import { Button, Modal, Progress } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import simpleQueueRun from "simple-queue-run";

import "./index.css";

import type { ModalProps } from "antd/lib/modal";

type FailResult<T> = {
    dataItem: T;
    error: unknown;
};

export type BatchTaskProgressModalProps<T> = ModalProps & {
    data: T[];
    action: (item: T) => Promise<unknown>;
    failsRender?: (failsResult: FailResult<T>[]) => React.ReactNode;
    onOk?: () => void;
    onCancel?: () => void;
};

export default function BatchTaskProgressModal<T>({
    data,
    action,
    failsRender,
    ...modalProps
}: BatchTaskProgressModalProps<T>) {
    const { t } = useTranslation();
    const [loading, setLoading] = useState(true);
    const [percent, setPercent] = useState(0);
    const [successPercent, setSuccessPercent] = useState(0);
    const [doneNum, setDoneNum] = useState(0);
    const [failsResult, setFailsResult] = useState<FailResult<T>[]>([]);
    const [showErrMsg, setShowErrMsg] = useState(false);
    const abortControllerRef = useRef<AbortController>();

    function handleCancel() {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        modalProps.onCancel?.();
    }

    // biome-ignore lint/correctness/useExhaustiveDependencies: false
    useEffect(() => {
        let success = 0;
        let done = 0;
        const total = data.length;
        abortControllerRef.current = new AbortController();
        simpleQueueRun(
            data.map((item) => () => {
                return action(item)
                    .then(() => {
                        done++;
                        setSuccessPercent((++success * 100) / total);
                        setPercent((done * 100) / total);
                        setDoneNum(done);
                    })
                    .catch((err) => {
                        done++;
                        setFailsResult((failsResult1) => [
                            ...failsResult1,
                            {
                                dataItem: item,
                                error: err,
                            },
                        ]);
                        setDoneNum(done);
                        setPercent((done * 100) / total);
                        console.warn(err);
                    });
            }),
            {
                signal: abortControllerRef.current.signal,
            },
        ).then(() => {
            if (abortControllerRef.current?.signal.aborted) {
                modalProps.onCancel?.();
            } else {
                setLoading(false);
                modalProps.onOk?.();
            }
        });
        return () => {
            abortControllerRef.current?.abort();
            modalProps.onCancel?.();
        };
    }, []);

    return (
        <Modal
            title="批处理任务进度"
            {...modalProps}
            transitionName=""
            maskTransitionName=""
            closable={false}
            maskClosable={false}
            keyboard={false}
            footer={
                loading ? (
                    <Button type="primary" danger onClick={handleCancel}>
                        {t("app_btn_cancel")}
                    </Button>
                ) : (
                    <Button type="primary" onClick={modalProps.onOk}>
                        {t("app_btn_ok")}
                    </Button>
                )
            }
        >
            <div className="batchTaskProgressModalProgressWrapper">
                <Progress
                    percent={percent}
                    success={{ percent: successPercent }}
                    format={() => ""}
                />
                <span className="batchTaskProgressModalProgressText">
                    {doneNum} / {data.length}
                </span>
            </div>

            <div
                style={{ display: failsResult.length > 0 ? "block" : "none" }}
                onClick={() => setShowErrMsg(!showErrMsg)}
            >
                <WarningOutlined />
                <span>
                    {"{{count}} 个任务失败".replace(
                        "{{count}}",
                        `${failsResult.length}`,
                    )}
                </span>
            </div>
            <div style={{ display: showErrMsg ? "block" : "none" }}>
                {failsRender?.(failsResult)}
            </div>
        </Modal>
    );
}
