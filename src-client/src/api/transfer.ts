import axios from "axios";

import {
    deleteMockTransferTask,
    getMockTransferTask,
    getMockTransferTasks,
    isMockTransferTaskId,
    setMockTransferTaskStatus,
} from "./transfer.mock";

import type { ITransferRange } from "@/services/transfer/types";

export type ITransferTaskType = "UPLOAD" | "DOWNLOAD";
export type ITransferTaskStatus =
    | "WAIT"
    | "RUN"
    | "PAUSE"
    | "SUCCESS"
    | "FAIL"
    | "CANCEL";

export interface ITransferTask {
    id: string;
    type: ITransferTaskType;
    status: ITransferTaskStatus;
    local_path?: string;
    target_uri?: string;
    target_id?: number;
    name: string;
    loaded: number;
    total: number;
    percent: number;
    speed: number;
    estimated_time?: number;
    ranges: ITransferRange[];
    fail_reason?: string;
    created_at: number;
    updated_at: number;
    ended_at?: number;
}

export async function postTransferUpload(payload: {
    local_path: string;
    target_uri: string;
}) {
    const response = await axios.post<ITransferTask>(
        "/api/transfer/upload",
        payload,
    );
    return response.data;
}

export async function postTransferDownload(payload: {
    source_uri: string;
    local_path?: string;
    local_dir?: string;
}) {
    const response = await axios.post<ITransferTask>(
        "/api/transfer/download",
        payload,
    );
    return response.data;
}

export async function getTransferTask(id: string) {
    if (import.meta.env.DEV && isMockTransferTaskId(id)) {
        return getMockTransferTask(id);
    }
    const response = await axios.get<ITransferTask>(`/api/transfer/${id}`);
    return response.data;
}

export async function getTransferTasks() {
    const response = await axios.get<ITransferTask[]>("/api/transfer/list");
    return import.meta.env.DEV
        ? [...getMockTransferTasks(), ...response.data]
        : response.data;
}

export async function postTransferPause(id: string) {
    if (import.meta.env.DEV && isMockTransferTaskId(id)) {
        return setMockTransferTaskStatus(id, "PAUSE");
    }
    const response = await axios.post<ITransferTask>(
        `/api/transfer/${id}/pause`,
    );
    return response.data;
}

export async function postTransferResume(id: string) {
    if (import.meta.env.DEV && isMockTransferTaskId(id)) {
        return setMockTransferTaskStatus(id, "RUN");
    }
    const response = await axios.post<ITransferTask>(
        `/api/transfer/${id}/resume`,
    );
    return response.data;
}

export async function postTransferCancel(id: string) {
    if (import.meta.env.DEV && isMockTransferTaskId(id)) {
        return setMockTransferTaskStatus(id, "CANCEL");
    }
    const response = await axios.post<ITransferTask>(
        `/api/transfer/${id}/cancel`,
    );
    return response.data;
}

export async function deleteTransferTask(id: string) {
    if (import.meta.env.DEV && isMockTransferTaskId(id)) {
        deleteMockTransferTask(id);
        return;
    }
    await axios.delete(`/api/transfer/${id}`);
}
