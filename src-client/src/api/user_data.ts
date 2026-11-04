import axios from "axios";

export interface IEncryptedUserDataExport {
    version: number;
    algorithm: string;
    salt: string;
    nonce: string;
    ciphertext: string;
}

export async function postUserDataExport(data: {
    password?: string;
    settings: unknown;
}) {
    const response = await axios.post<unknown>("/api/user_data/export", data);
    return response.data;
}

export async function postUserDataImport(data: {
    password?: string;
    data: unknown;
}) {
    const response = await axios.post<{
        added_targets: number;
        skipped_targets: number;
        imported_favorites: number;
        settings: unknown;
    }>("/api/user_data/import", data);
    return response.data;
}
