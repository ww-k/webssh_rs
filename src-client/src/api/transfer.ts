import axios from "axios";

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
    source_uri?: string;
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
    const response = await axios.get<ITransferTask>(`/api/transfer/${id}`);
    return response.data;
}

export async function getTransferTasks() {
    const response = await axios.get<ITransferTask[]>("/api/transfer/list");
    return response.data;
}

export async function postTransferPause(id: string) {
    const response = await axios.post<ITransferTask>(
        `/api/transfer/${id}/pause`,
    );
    return response.data;
}

export async function postTransferResume(id: string) {
    const response = await axios.post<ITransferTask>(
        `/api/transfer/${id}/resume`,
    );
    return response.data;
}

export async function postTransferCancel(id: string) {
    const response = await axios.post<ITransferTask>(
        `/api/transfer/${id}/cancel`,
    );
    return response.data;
}

export async function deleteTransferTask(id: string) {
    await axios.delete(`/api/transfer/${id}`);
}
