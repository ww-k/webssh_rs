import axios from "axios";

export interface IUserDataTarget {
    id: number;
    name?: string;
    host: string;
    port?: number;
    method: number;
    user: string;
    key?: string;
    password?: string;
    system?: string;
    jump_host_id?: number;
}

export interface IUserDataExport {
    version: 1;
    exported_at: string;
    targets: IUserDataTarget[];
    favorite_directories: Array<{
        target_id: number;
        name: string;
        path: string;
    }>;
}

export async function getUserDataExport() {
    const response = await axios.get<IUserDataExport>("/api/user_data/export");
    return response.data;
}

export async function postUserDataImport(data: IUserDataExport) {
    const response = await axios.post<{
        added_targets: number;
        skipped_targets: number;
        imported_favorites: number;
    }>("/api/user_data/import", data);
    return response.data;
}
