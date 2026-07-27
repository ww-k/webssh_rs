import { expect, test } from "@rstest/core";

import {
    getLastLocalDirectory,
    setLastLocalDirectory,
} from "./lastLocalDirectory";

test("[FsSelector] remembers the last local directory", () => {
    const values = new Map<string, string>();
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(getLastLocalDirectory(storage)).toBeUndefined();

    setLastLocalDirectory("/Users/kevin/Downloads", storage);

    expect(getLastLocalDirectory(storage)).toBe("/Users/kevin/Downloads");
});

test("[FsSelector] ignores unavailable browser storage", () => {
    const storage = {
        getItem: () => {
            throw new Error("storage unavailable");
        },
        setItem: () => {
            throw new Error("storage unavailable");
        },
    };

    expect(getLastLocalDirectory(storage)).toBeUndefined();
    expect(() => setLastLocalDirectory("/tmp", storage)).not.toThrow();
});
