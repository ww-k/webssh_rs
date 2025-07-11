export const SearchSftpProtocal = "search:";

export function isSearchUri(uri: string) {
    return uri.startsWith(SearchSftpProtocal);
}

export function parseSearchUri(uri: string) {
    const searchParams = new URLSearchParams(
        uri.substring(SearchSftpProtocal.length),
    );
    const dirName = searchParams.get("dirName") || "";
    const searchValue = searchParams.get("searchValue") || "";
    const searchLocation = searchParams.get("searchLocation") || "";
    return { dirName, searchValue, searchLocation };
}

export function buildSearchUri(
    searchLocation: string,
    searchValue: string,
    pathSep: string,
) {
    let params = {
        dirName: "",
        searchValue,
        searchLocation,
    };
    if (isSearchUri(searchLocation)) {
        params = parseSearchUri(searchLocation);
        params.searchValue = searchValue;
    } else {
        // @ts-ignore
        params.dirName = searchLocation.split(pathSep).pop();
    }
    return `${SearchSftpProtocal}dirName=${params.dirName}&searchValue=${encodeURIComponent(params.searchValue)}&searchLocation=${encodeURIComponent(params.searchLocation)}`;
}
