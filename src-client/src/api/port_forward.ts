import axios from "axios";

export interface IPortForward {
    id: string;
    name: string;
    local_host: string;
    local_port: number;
    remote_host: string;
    remote_port: number;
    target_id: number;
    enabled: boolean;
}

export interface IPortForwardPayload {
    name: string;
    target_id: number;
    local_host: string;
    local_port: number;
    remote_host: string;
    remote_port: number;
}

export interface IPortForwardUpdatePayload extends IPortForwardPayload {
    id: string;
}

export async function getPortForwardList() {
    const response = await axios.get<IPortForward[]>("/api/port_forward/list");
    return response.data;
}

export async function postPortForwardCreate(data: IPortForwardPayload) {
    const response = await axios.post<IPortForward>(
        "/api/port_forward/create",
        data,
    );
    return response.data;
}

export async function postPortForwardRemove(id: string) {
    await axios.post<void>("/api/port_forward/remove", { id });
}

export async function postPortForwardUpdate(data: IPortForwardUpdatePayload) {
    const response = await axios.post<IPortForward>(
        "/api/port_forward/update",
        data,
    );
    return response.data;
}

export async function postPortForwardToggle(id: string, enabled: boolean) {
    const response = await axios.post<IPortForward>(
        "/api/port_forward/toggle",
        { id, enabled },
    );
    return response.data;
}
