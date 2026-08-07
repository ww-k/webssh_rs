import axios from "axios";

export interface IFavorite {
    id: number;
    target_id: number;
    name: string;
    path: string;
    created_at: number;
}

export async function getFavoriteList(targetId: number) {
    const response = await axios.get<IFavorite[]>("/api/favorite/list", {
        params: { target_id: targetId },
    });
    return response.data;
}

export async function postFavoriteAdd(payload: {
    target_id: number;
    name: string;
    path: string;
}) {
    const response = await axios.post<IFavorite>("/api/favorite/add", payload);
    return response.data;
}

export async function postFavoriteRemove(payload: {
    target_id: number;
    path: string;
}) {
    await axios.post("/api/favorite/remove", payload);
}
