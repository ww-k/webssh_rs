import axios from "axios";

export interface ISshKnownHost {
    id: number;
    host: string;
    port: number;
    key_algorithm: string;
    public_key: string;
    fingerprint: string;
}

export async function getSshKnownHostList() {
    const response = await axios.get<ISshKnownHost[]>(
        "/api/ssh_known_host/list",
    );
    return response.data;
}

export async function postSshKnownHostRemove(id: number) {
    await axios.post("/api/ssh_known_host/remove", { id });
}
