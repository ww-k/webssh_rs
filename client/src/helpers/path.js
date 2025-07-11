/** biome-ignore-all lint/correctness/noInnerDeclarations: false */
/** biome-ignore-all lint/complexity/noArguments: false */
/** biome-ignore-all lint/suspicious/noRedeclare: false */
var isWindows =
    ["Windows", "Win16", "Win32", "WinCE", "win32"].indexOf(
        navigator.platform,
    ) >= 0;

function isString(arg) {
    return (
        typeof arg === "string" ||
        (typeof arg === "object" &&
            Object.prototype.toString.call(arg) === "[object String]")
    );
}
// resolves . and .. elements in a path array with directory names there
// must be no slashes or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
    var res = [];
    for (var i = 0; i < parts.length; i++) {
        var p = parts[i];

        // ignore empty parts
        if (!p || p === ".") continue;

        if (p === "..") {
            if (res.length && res[res.length - 1] !== "..") {
                res.pop();
            } else if (allowAboveRoot) {
                res.push("..");
            }
        } else {
            res.push(p);
        }
    }

    return res;
}

// returns an array with empty elements removed from either end of the input
// array or the original array if no elements need to be removed
function trimArray(arr) {
    var lastIndex = arr.length - 1;
    var start = 0;
    for (; start <= lastIndex; start++) {
        if (arr[start]) break;
    }

    var end = lastIndex;
    for (; end >= 0; end--) {
        if (arr[end]) break;
    }

    if (start === 0 && end === lastIndex) return arr;
    if (start > end) return [];
    return arr.slice(start, end + 1);
}

// Regex to split a windows path into three parts: [*, device, slash,
// tail] windows-only
var splitDeviceRe =
    /^([a-zA-Z]:|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)?([\\/])?([\s\S]*?)$/;

// Regex to split the tail part of the above into [*, dir, basename, ext]
var splitTailRe = /^([\s\S]*?)((?:\.{1,2}|[^\\/]+?|)(\.[^./\\]*|))(?:[\\/]*)$/;

export const win32 = {};

// Function to split a filename into [root, dir, basename, ext]
function win32SplitPath(filename) {
    // Separate device+slash from tail
    var result = splitDeviceRe.exec(filename);
    var device = (result[1] || "") + (result[2] || "");
    var tail = result[3] || "";
    // Split the tail into dir, basename and extension
    var result2 = splitTailRe.exec(tail);
    var dir = result2[1];
    var basename = result2[2];
    var ext = result2[3];
    return [device, dir, basename, ext];
}

function win32StatPath(path) {
    var result = splitDeviceRe.exec(path);
    var device = result[1] || "";
    var isUnc = !!device && device[1] !== ":";
    return {
        device: device,
        isUnc: isUnc,
        isAbsolute: isUnc || !!result[2], // UNC paths are always absolute
        tail: result[3],
    };
}

function normalizeUNCRoot(device) {
    return `\\\\${device.replace(/^[\\/]+/, "").replace(/[\\/]+/g, "\\")}`;
}

// path.resolve([from ...], to)
win32.resolve = (...args) => {
    var resolvedDevice = "";
    var resolvedTail = "";
    var resolvedAbsolute = false;

    for (var i = args.length - 1; i >= -1; i--) {
        var path;
        if (i >= 0) {
            path = args[i];
        } else if (!resolvedDevice) {
            return "";
        } else {
            return "";
        }

        // Skip empty and invalid entries
        if (!isString(path)) {
            throw new TypeError("Arguments to path.resolve must be strings");
        }
        if (!path) {
            continue;
        }

        var result = win32StatPath(path);
        var device = result.device;
        var isUnc = result.isUnc;
        var isAbsolute = result.isAbsolute;
        var tail = result.tail;

        if (
            device &&
            resolvedDevice &&
            device.toLowerCase() !== resolvedDevice.toLowerCase()
        ) {
            // This path points to another device so it is not applicable
            continue;
        }

        if (!resolvedDevice) {
            resolvedDevice = device;
        }
        if (!resolvedAbsolute) {
            resolvedTail = `${tail}\\${resolvedTail}`;
            resolvedAbsolute = isAbsolute;
        }

        if (resolvedDevice && resolvedAbsolute) {
            break;
        }
    }

    // Convert slashes to backslashes when `resolvedDevice` points to an UNC
    // root. Also squash multiple slashes into a single one where appropriate.
    if (isUnc) {
        resolvedDevice = normalizeUNCRoot(resolvedDevice);
    }

    // At this point the path should be resolved to a full absolute path,
    // but handle relative paths to be safe (might happen when process.cwd()
    // fails)

    // Normalize the tail path
    resolvedTail = normalizeArray(
        resolvedTail.split(/[\\/]+/),
        !resolvedAbsolute,
    ).join("\\");

    return (
        resolvedDevice + (resolvedAbsolute ? "\\" : "") + resolvedTail || "."
    );
};

win32.normalize = (path) => {
    var result = win32StatPath(path);
    var device = result.device;
    var isUnc = result.isUnc;
    var isAbsolute = result.isAbsolute;
    var tail = result.tail;
    var trailingSlash = /[\\/]$/.test(tail);

    // Normalize the tail path
    tail = normalizeArray(tail.split(/[\\/]+/), !isAbsolute).join("\\");

    if (!tail && !isAbsolute) {
        tail = ".";
    }
    if (tail && trailingSlash) {
        tail += "\\";
    }

    // Convert slashes to backslashes when `device` points to an UNC root.
    // Also squash multiple slashes into a single one where appropriate.
    if (isUnc) {
        device = normalizeUNCRoot(device);
    }

    return device + (isAbsolute ? "\\" : "") + tail;
};

win32.isAbsolute = (path) => win32StatPath(path).isAbsolute;

win32.join = (...args) => {
    var paths = [];
    for (var i = 0; i < args.length; i++) {
        var arg = args[i];
        if (!isString(arg)) {
            throw new TypeError("Arguments to path.join must be strings");
        }
        if (arg) {
            paths.push(arg);
        }
    }

    var joined = paths.join("\\");

    // Make sure that the joined path doesn't start with two slashes, because
    // normalize() will mistake it for an UNC path then.
    //
    // This step is skipped when it is very clear that the user actually
    // intended to point at an UNC path. This is assumed when the first
    // non-empty string arguments starts with exactly two slashes followed by
    // at least one more non-slash character.
    //
    // Note that for normalize() to treat a path as an UNC path it needs to
    // have at least 2 components, so we don't filter for that here.
    // This means that the user can use join to construct UNC paths from
    // a server name and a share name; for example:
    //   path.join('//server', 'share') -> '\\\\server\\share\')
    if (!/^[\\/]{2}[^\\/]/.test(paths[0])) {
        joined = joined.replace(/^[\\/]{2,}/, "\\");
    }

    return win32.normalize(joined);
};

// path.relative(from, to)
// it will solve the relative path from 'from' to 'to', for instance:
// from = 'C:\\orandea\\test\\aaa'
// to = 'C:\\orandea\\impl\\bbb'
// The output of the function should be: '..\\..\\impl\\bbb'
win32.relative = (from, to) => {
    from = win32.resolve(from);
    to = win32.resolve(to);

    // windows is not case sensitive
    var lowerFrom = from.toLowerCase();
    var lowerTo = to.toLowerCase();

    var toParts = trimArray(to.split("\\"));

    var lowerFromParts = trimArray(lowerFrom.split("\\"));
    var lowerToParts = trimArray(lowerTo.split("\\"));

    var length = Math.min(lowerFromParts.length, lowerToParts.length);
    var samePartsLength = length;
    for (var i = 0; i < length; i++) {
        if (lowerFromParts[i] !== lowerToParts[i]) {
            samePartsLength = i;
            break;
        }
    }

    if (samePartsLength === 0) {
        return to;
    }

    var outputParts = [];
    for (var i = samePartsLength; i < lowerFromParts.length; i++) {
        outputParts.push("..");
    }

    outputParts = outputParts.concat(toParts.slice(samePartsLength));

    return outputParts.join("\\");
};

win32._makeLong = (path) => {
    // Note: this will *probably* throw somewhere.
    if (!isString(path)) return path;

    if (!path) {
        return "";
    }

    var resolvedPath = win32.resolve(path);

    if (/^[a-zA-Z]:\\/.test(resolvedPath)) {
        // path is local filesystem path, which needs to be converted
        // to long UNC path.
        return `\\\\?\\${resolvedPath}`;
    }
    if (/^\\\\[^?.]/.test(resolvedPath)) {
        // path is network UNC path, which needs to be converted
        // to long UNC path.
        return `\\\\?\\UNC\\${resolvedPath.substring(2)}`;
    }

    return path;
};

win32.dirname = (path) => {
    var result = win32SplitPath(path);
    var root = result[0];
    var dir = result[1];

    if (!root && !dir) {
        // No dirname whatsoever
        return ".";
    }

    if (dir) {
        // It has a dirname, strip trailing slash
        dir = dir.substr(0, dir.length - 1);
    }

    return root + dir;
};

win32.basename = (path, ext) => {
    var f = win32SplitPath(path)[2];
    // TODO: make this comparison case-insensitive on windows?
    if (ext && f.substr(-1 * ext.length) === ext) {
        f = f.substr(0, f.length - ext.length);
    }
    return f;
};

win32.extname = (path) => win32SplitPath(path)[3];

win32.format = (pathObject) => {
    if (!util.isObject(pathObject)) {
        throw new TypeError(
            `Parameter 'pathObject' must be an object, not ${typeof pathObject}`,
        );
    }

    var root = pathObject.root || "";

    if (!isString(root)) {
        throw new TypeError(
            `'pathObject.root' must be a string or undefined, not ${typeof pathObject.root}`,
        );
    }

    var dir = pathObject.dir;
    var base = pathObject.base || "";
    if (!dir) {
        return base;
    }
    if (dir[dir.length - 1] === win32.sep) {
        return dir + base;
    }
    return dir + win32.sep + base;
};

win32.parse = (pathString) => {
    if (!isString(pathString)) {
        throw new TypeError(
            `Parameter 'pathString' must be a string, not ${typeof pathString}`,
        );
    }
    var allParts = win32SplitPath(pathString);
    if (!allParts || allParts.length !== 4) {
        throw new TypeError(`Invalid path '${pathString}'`);
    }
    return {
        root: allParts[0],
        dir: allParts[0] + allParts[1].slice(0, -1),
        base: allParts[2],
        ext: allParts[3],
        name: allParts[2].slice(0, allParts[2].length - allParts[3].length),
    };
};

win32.sep = "\\";
win32.delimiter = ";";

// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^/]+?|)(\.[^./]*|))(?:[/]*)$/;
export const posix = {};

function posixSplitPath(filename) {
    return splitPathRe.exec(filename).slice(1);
}

// path.resolve([from ...], to)
// posix version
posix.resolve = (...args) => {
    var resolvedPath = "";
    var resolvedAbsolute = false;

    for (var i = args.length - 1; i >= -1 && !resolvedAbsolute; i--) {
        var path = i >= 0 ? args[i] : "/";

        // Skip empty and invalid entries
        if (!isString(path)) {
            throw new TypeError("Arguments to path.resolve must be strings");
        }
        if (!path) {
            continue;
        }

        resolvedPath = `${path}/${resolvedPath}`;
        resolvedAbsolute = path[0] === "/";
    }

    // At this point the path should be resolved to a full absolute path, but
    // handle relative paths to be safe (might happen when process.cwd() fails)

    // Normalize the path
    resolvedPath = normalizeArray(
        resolvedPath.split("/"),
        !resolvedAbsolute,
    ).join("/");

    return (resolvedAbsolute ? "/" : "") + resolvedPath || ".";
};

// path.normalize(path)
// posix version
posix.normalize = (path) => {
    var isAbsolute = posix.isAbsolute(path);
    var trailingSlash = path && path[path.length - 1] === "/";

    // Normalize the path
    path = normalizeArray(path.split("/"), !isAbsolute).join("/");

    if (!path && !isAbsolute) {
        path = ".";
    }
    if (path && trailingSlash) {
        path += "/";
    }

    return (isAbsolute ? "/" : "") + path;
};

// posix version
posix.isAbsolute = (path) => path.charAt(0) === "/";

// posix version
posix.join = (...args) => {
    var path = "";
    for (var i = 0; i < args.length; i++) {
        var segment = args[i];
        if (!isString(segment)) {
            throw new TypeError("Arguments to path.join must be strings");
        }
        if (segment) {
            if (!path) {
                path += segment;
            } else {
                path += `/${segment}`;
            }
        }
    }
    return posix.normalize(path);
};

// path.relative(from, to)
// posix version
posix.relative = (from, to) => {
    from = posix.resolve(from).substr(1);
    to = posix.resolve(to).substr(1);

    var fromParts = trimArray(from.split("/"));
    var toParts = trimArray(to.split("/"));

    var length = Math.min(fromParts.length, toParts.length);
    var samePartsLength = length;
    for (var i = 0; i < length; i++) {
        if (fromParts[i] !== toParts[i]) {
            samePartsLength = i;
            break;
        }
    }

    var outputParts = [];
    for (var i = samePartsLength; i < fromParts.length; i++) {
        outputParts.push("..");
    }

    outputParts = outputParts.concat(toParts.slice(samePartsLength));

    return outputParts.join("/");
};

posix._makeLong = (path) => path;

posix.dirname = (path) => {
    var result = posixSplitPath(path);
    var root = result[0];
    var dir = result[1];

    if (!root && !dir) {
        // No dirname whatsoever
        return ".";
    }

    if (dir) {
        // It has a dirname, strip trailing slash
        dir = dir.substr(0, dir.length - 1);
    }

    return root + dir;
};

posix.basename = (path, ext) => {
    var f = posixSplitPath(path)[2];
    // TODO: make this comparison case-insensitive on windows?
    if (ext && f.substr(-1 * ext.length) === ext) {
        f = f.substr(0, f.length - ext.length);
    }
    return f;
};

posix.extname = (path) => posixSplitPath(path)[3];

posix.format = (pathObject) => {
    if (!util.isObject(pathObject)) {
        throw new TypeError(
            `Parameter 'pathObject' must be an object, not ${typeof pathObject}`,
        );
    }

    var root = pathObject.root || "";

    if (!isString(root)) {
        throw new TypeError(
            `'pathObject.root' must be a string or undefined, not ${typeof pathObject.root}`,
        );
    }

    var dir = pathObject.dir ? pathObject.dir + posix.sep : "";
    var base = pathObject.base || "";
    return dir + base;
};

posix.parse = (pathString) => {
    if (!isString(pathString)) {
        throw new TypeError(
            `Parameter 'pathString' must be a string, not ${typeof pathString}`,
        );
    }
    var allParts = posixSplitPath(pathString);
    if (!allParts || allParts.length !== 4) {
        throw new TypeError(`Invalid path '${pathString}'`);
    }
    allParts[1] = allParts[1] || "";
    allParts[2] = allParts[2] || "";
    allParts[3] = allParts[3] || "";

    return {
        root: allParts[0],
        dir: allParts[0] + allParts[1].slice(0, -1),
        base: allParts[2],
        ext: allParts[3],
        name: allParts[2].slice(0, allParts[2].length - allParts[3].length),
    };
};

posix.sep = "/";
posix.delimiter = ":";

export default isWindows ? win32 : posix;
