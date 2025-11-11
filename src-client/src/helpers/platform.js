const userAgent = navigator.userAgent;
const platform = navigator.platform || "";

function contains(arr, el) {
    return arr.indexOf(el) >= 0;
}

export const isFirefox = !!~userAgent.indexOf("Firefox");
export const isMSIE =
    !!~userAgent.indexOf("MSIE") || !!~userAgent.indexOf("Trident");
export const isMSEgde = !!~userAgent.indexOf("Edge");
export const isMac = contains(
    ["Macintosh", "MacIntel", "MacPPC", "Mac68K", "darwin"],
    platform,
);
export const isIpad = platform === "iPad";
export const isIphone = platform === "iPhone";
export const isMSWindows = contains(
    ["Windows", "Win16", "Win32", "WinCE", "win32"],
    platform,
);
export const isLinux = platform.indexOf("Linux") >= 0;
