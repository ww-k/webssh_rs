import axios from "axios";

export interface IFavoriteDirectory {
    id: number;
    target_id: number;
    name: string;
    path: string;
    is_default: boolean;
    created_at: number;
}

export async function getFavoriteDirectoryList(targetId: number) {
    const response = await axios.get<IFavoriteDirectory[]>(
        "/api/favorite_directory/list",
        {
            params: { target_id: targetId },
        },
    );
    return response.data;
}

export async function postFavoriteDirectoryAdd(payload: {
    target_id: number;
    name: string;
    path: string;
}) {
    const response = await axios.post<IFavoriteDirectory>(
        "/api/favorite_directory/add",
        payload,
    );
    return response.data;
}

export async function postFavoriteDirectoryRemove(payload: {
    target_id: number;
    path: string;
}) {
    await axios.post("/api/favorite_directory/remove", payload);
}
