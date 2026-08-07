import { expect, test } from "@rstest/core";

import {
    favoriteDirectoryToQuickLink,
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
        created_at: 1,
    };

    expect(favoriteDirectoryToQuickLink(favoriteDirectory)).toEqual({
        name: "/var/log",
        path: "sftp:7:/var/log",
    });
    expect(
        favoriteDirectoryToQuickLink({
            ...favoriteDirectory,
            target_id: 0,
        }).path,
    ).toBe("/var/log");
});

test("[Pathbar] uses the directory name as the default favorite directory name", () => {
    expect(getFavoriteDirectoryDefaultName("/Users/test")).toBe("test");
    expect(getFavoriteDirectoryDefaultName("sftp:7:/var/log/")).toBe("log");
    expect(getFavoriteDirectoryDefaultName("C:\\Users\\test\\")).toBe("test");
    expect(getFavoriteDirectoryDefaultName("/")).toBe("/");
});
