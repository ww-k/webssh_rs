import axios from "axios";

export interface ITarget {
    id: number;
    host: string;
    port?: number;
    method: number;
    user: string;
    key?: string;
    password?: string;
    system?: string;
}

export async function getTargetList() {
    const response = await axios.get<ITarget[]>("/api/target/list");
    return response.data;
}

export async function postTargetAdd(data: Omit<ITarget, "id">) {
    const response = await axios.post<ITarget[]>("/api/target/add", data);
    return response.data;
}

export async function postTargetUpdate(data: ITarget) {
    const response = await axios.post<ITarget[]>("/api/target/update", data);
    return response.data;
}

export async function postTargetRemove(id: number) {
    const response = await axios.post<ITarget[]>("/api/target/remove", { id });
    return response.data;
}
