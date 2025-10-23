import { create } from "zustand";

import type { ITransferProgressEvent, ITransferRange } from "./types";

interface ITransferListItem {
    /** id  */
    id: string;
    /** 传输类型 */
    type: "UPLOAD" | "DOWNLOAD";
    /** 任务状态 */
    status: "WAIT" | "RUN" | "SUCCESS" | "FAIL" | "PAUSE";
    /** 本地文件路径。Web端，是文件名。客户端，是本地文件路径。 */
    local: string;
    /** 远端文件uri */
    remote: string;
    /** 文件名 */
    name: string;
    /** 结束时间 */
    endDate?: number;
    /** 预估剩余时间 */
    estimatedTime?: number;
    /** 已传输大小 */
    loaded: number;
    /** 进度百分比 */
    percent?: number;
    /** 文件大小 */
    size?: number;
    /** 缺少的文件块记录 */
    missedRanges?: ITransferRange[];
    /** 传输速度 */
    speed?: number;
    /** 失败原因 */
    failReason?: string;
}

type ITransferStore = {
    list: ITransferListItem[];
    get: (id: string) => ITransferListItem | undefined;
    add: (task: ITransferListItem) => void;
    delete: (id: string) => void;
    updateProgress: (id: string, progress: ITransferProgressEvent) => void;
    setRun: (id: string) => void;
    setPause: (id: string) => void;
    setResume: (id: string) => void;
    setSuccess: (id: string) => void;
    setFail: (id: string, failReason: string) => void;
};

const useTransferStore = create<ITransferStore>((set, get) => {
    function updateStateById(id: string, patch: Partial<ITransferListItem>) {
        set((state) => {
            const newList = [...state.list];
            const index = newList.findIndex((item) => item.id === id);
            if (index !== -1) {
                newList[index] = {
                    ...newList[index],
                    ...patch,
                };
                return { list: newList };
            }
            return state;
        });
    }
    return {
        list: [],
        get: (id) => {
            return get().list.find((item) => item.id === id);
        },
        add: (task) => {
            set((state) => {
                const newList = [...state.list];
                newList.push(task);
                return { list: newList };
            });
        },
        delete: (id) => {
            set((state) => {
                const newList = state.list.filter((item) => item.id !== id);
                return { list: newList };
            });
        },
        updateProgress: (id, progress) => {
            updateStateById(id, progress);
        },
        setRun: (id) => {
            updateStateById(id, {
                status: "RUN",
            });
        },
        setPause: (id: string) => {
            updateStateById(id, {
                status: "PAUSE",
            });
        },
        setResume: (id: string) => {
            updateStateById(id, {
                status: "WAIT",
            });
        },
        setSuccess: (id) => {
            updateStateById(id, {
                status: "SUCCESS",
            });
        },
        setFail: (id, failReason) => {
            updateStateById(id, {
                status: "FAIL",
                failReason,
            });
        },
    };
});

export default useTransferStore;
