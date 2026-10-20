import axios from "axios";

export interface ISshConnection {
    id: string;
    expired: boolean;
    closed: boolean;
    target_id: number;
    active_channels: number;
}

export interface ISshConnectionSelector {
    target_id: number;
    connection_id: string;
}

export async function getSshConnectionList(target_id?: number) {
    const response = await axios.get<ISshConnection[]>(
        "/api/ssh_connection/list",
        { params: target_id === undefined ? undefined : { target_id } },
    );
    return response.data;
}

export async function postSshConnectionExpire(params: ISshConnectionSelector) {
    await axios.post("/api/ssh_connection/expire", null, { params });
}

export async function postSshConnectionClose(params: ISshConnectionSelector) {
    await axios.post("/api/ssh_connection/close", null, { params });
}
