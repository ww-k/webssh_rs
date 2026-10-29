import axios from "axios";

import type { ITransferRange } from "@/services/transfer/types";

export type ITransferTaskType = "UPLOAD" | "DOWNLOAD";
export type ITransferTaskKind = "FILE" | "DIRECTORY";
export type ITransferTaskStatus =
    | "WAIT"
    | "RUN"
    | "PAUSE"
    | "SUCCESS"
    | "FAIL"
    | "CANCEL";
export type ITransferConflictPolicy = "OVERWRITE" | "SKIP" | "RENAME" | "FAIL";

export interface ITransferTask {
    id: string;
    type: ITransferTaskType;
    kind?: ITransferTaskKind;
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
    batch_id?: string;
    relative_path?: string;
    conflict_policy?: ITransferConflictPolicy;
    all?: boolean;
}

export interface ITransferBatch {
    id: string;
    type: ITransferTaskType;
    status: ITransferTaskStatus;
    name: string;
    target_id?: number;
    conflict_policy: ITransferConflictPolicy;
    item_count: number;
    completed_count: number;
    failed_count: number;
    directory_count: number;
    directory_failed_count: number;
    total: number;
    loaded: number;
    percent?: number;
    speed: number;
    estimated_time?: number;
    fail_reason?: string;
    created_at: number;
    updated_at: number;
    ended_at?: number;
}

export interface ITransferBatchItems {
    items: ITransferTask[];
    total: number;
}

export interface ITransferBatchList {
    items: ITransferBatch[];
    total: number;
}

export async function postTransferUploadBatch(payload: {
    target_uri: string;
    sources: string[];
    name: string;
    all?: boolean;
    conflict_policy?: ITransferConflictPolicy;
}) {
    const response = await axios.post<ITransferBatch>(
        "/api/transfer/batches/upload",
        payload,
    );
    return response.data;
}

export async function postTransferDownloadBatch(payload: {
    sources: string[];
    local_dir: string;
    name: string;
    all?: boolean;
    conflict_policy?: ITransferConflictPolicy;
}) {
    const response = await axios.post<ITransferBatch>(
        "/api/transfer/batches/download",
        payload,
    );
    return response.data;
}

export async function getTransferBatches(params?: {
    page?: number;
    page_size?: number;
    type?: ITransferTaskType;
    status?: ITransferTaskStatus;
}) {
    const response = await axios.get<ITransferBatchList>(
        "/api/transfer/batches",
        { params },
    );
    return response.data;
}

export async function getTransferBatch(id: string) {
    const response = await axios.get<ITransferBatch>(
        `/api/transfer/batches/${id}`,
    );
    return response.data;
}

export async function getTransferBatchItems(
    id: string,
    params?: { page?: number; page_size?: number },
) {
    const response = await axios.get<ITransferBatchItems>(
        `/api/transfer/batches/${id}/items`,
        { params },
    );
    return response.data;
}

export async function postTransferBatchPause(id: string) {
    return (
        await axios.post<ITransferBatch>(`/api/transfer/batches/${id}/pause`)
    ).data;
}
export async function postTransferBatchResume(id: string) {
    return (
        await axios.post<ITransferBatch>(`/api/transfer/batches/${id}/resume`)
    ).data;
}
export async function postTransferBatchCancel(id: string) {
    return (
        await axios.post<ITransferBatch>(`/api/transfer/batches/${id}/cancel`)
    ).data;
}
export async function deleteTransferBatch(id: string) {
    await axios.delete(`/api/transfer/batches/${id}`);
}

export async function deleteTransferHistory() {
    await axios.delete("/api/transfer/history");
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
