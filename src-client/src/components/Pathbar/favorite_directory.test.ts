import { expect, test } from "@rstest/core";

import {
    appendFavoriteDirectoryMenuItem,
    favoriteDirectoryToMenuItem,
    getFavoriteDirectoryDefaultKind,
    getFavoriteDirectoryDefaultName,
    getFavoriteDirectoryLocation,
} from "./favorite_directory";

test("[Pathbar] maps local and SFTP locations to favorite directory fields", () => {
    expect(getFavoriteDirectoryLocation("/Users/test")).toEqual({
        targetId: 0,
        path: "/Users/test",
    });
    expect(getFavoriteDirectoryLocation("sftp:12:/home/test")).toEqual({
        targetId: 12,
        path: "/home/test",
    });
});

test("[Pathbar] restores a navigable path from a favorite directory", () => {
    const favoriteDirectory = {
        id: 1,
        target_id: 7,
        name: "/var/log",
        path: "/var/log",
        is_default: false,
        created_at: 1,
    };

    expect(favoriteDirectoryToMenuItem(favoriteDirectory)).toEqual({
        name: "/var/log",
        path: "sftp:7:/var/log",
        isDefault: false,
    });
    expect(
        favoriteDirectoryToMenuItem({
            ...favoriteDirectory,
            target_id: 0,
        }).path,
    ).toBe("/var/log");
    expect(
        favoriteDirectoryToMenuItem({
            ...favoriteDirectory,
            is_default: true,
        }).isDefault,
    ).toBe(true);
});

test("[Pathbar] uses the directory name as the default favorite directory name", () => {
    expect(getFavoriteDirectoryDefaultName("/Users/test")).toBe("test");
    expect(getFavoriteDirectoryDefaultName("sftp:7:/var/log/")).toBe("log");
    expect(getFavoriteDirectoryDefaultName("C:\\Users\\test\\")).toBe("test");
    expect(getFavoriteDirectoryDefaultName("/")).toBe("/");
});

test("[Pathbar] only recognizes generated favorites as default directories", () => {
    expect(
        getFavoriteDirectoryDefaultKind({ name: "Home", isDefault: true }),
    ).toBe("Home");
    expect(
        getFavoriteDirectoryDefaultKind({ name: "Home", isDefault: false }),
    ).toBeNull();
    expect(
        getFavoriteDirectoryDefaultKind({ name: "Custom", isDefault: true }),
    ).toBeNull();
});

test("[Pathbar] does not append the same favorite directory twice", () => {
    const existing = {
        name: "Logs",
        path: "sftp:7:/var/log",
        isDefault: false,
    };
    const items = [existing];

    expect(appendFavoriteDirectoryMenuItem(items, existing)).toBe(items);
    expect(
        appendFavoriteDirectoryMenuItem(items, {
            name: "Home",
            path: "sftp:7:/home/test",
            isDefault: true,
        }),
    ).toHaveLength(2);
});
