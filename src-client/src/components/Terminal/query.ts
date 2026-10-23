export type QueryParams = Record<string, string>;

export function decodeQueryParam(search: string): QueryParams {
    const query = search.includes("?") ? search.slice(1) : search;
    if (!query) return {};

    return query.split("&").reduce<QueryParams>((params, value) => {
        const [key, rawValue = ""] = value.split("=");
        if (!key) return params;
        try {
            params[key] = decodeURIComponent(rawValue);
        } catch {
            params[key] = rawValue;
        }
        return params;
    }, {});
}

export function targetIdFromQuery(search = window.location.search) {
    const targetId = decodeQueryParam(search).target_id;
    if (!targetId) return undefined;

    const parsedTargetId = Number.parseInt(targetId, 10);
    return Number.isNaN(parsedTargetId) ? undefined : parsedTargetId;
}
