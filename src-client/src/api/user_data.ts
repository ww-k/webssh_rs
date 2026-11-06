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
    import_settings?: boolean;
    import_targets?: boolean;
    import_favorites?: boolean;
    target_conflict?: "skip" | "overwrite";
}) {
    const response = await axios.post<{
        added_targets: number;
        updated_targets: number;
        skipped_targets: number;
        imported_favorites: number;
        settings: unknown;
    }>("/api/user_data/import", data);
    return response.data;
}

export async function postUserDataImportUrl(data: {
    password?: string;
    url: string;
    import_settings?: boolean;
    import_targets?: boolean;
    import_favorites?: boolean;
    target_conflict?: "skip" | "overwrite";
}) {
    const response = await axios.post<{
        added_targets: number;
        updated_targets: number;
        skipped_targets: number;
        imported_favorites: number;
        settings: unknown;
    }>("/api/user_data/import/url", data);
    return response.data;
}
