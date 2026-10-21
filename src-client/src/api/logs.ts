import axios from "axios";

export async function getServerLogs() {
    const response = await axios.get<string[]>("/api/logs");
    return response.data;
}
