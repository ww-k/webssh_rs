import { expect, test } from "@rstest/core";

import {
    favoriteToQuickLink,
    getFavoriteDefaultName,
    getFavoriteLocation,
} from "./favorite";

test("[Pathbar] maps local and SFTP locations to server favorite fields", () => {
    expect(getFavoriteLocation("/Users/test")).toEqual({
        targetId: 0,
        path: "/Users/test",
    });
    expect(getFavoriteLocation("sftp:12:/home/test")).toEqual({
        targetId: 12,
        path: "/home/test",
    });
});

test("[Pathbar] restores a navigable path from a server favorite", () => {
    const favorite = {
        id: 1,
        target_id: 7,
        name: "/var/log",
        path: "/var/log",
        created_at: 1,
    };

    expect(favoriteToQuickLink(favorite)).toEqual({
        name: "/var/log",
        path: "sftp:7:/var/log",
    });
    expect(favoriteToQuickLink({ ...favorite, target_id: 0 }).path).toBe(
        "/var/log",
    );
});

test("[Pathbar] uses the current directory name as the default favorite name", () => {
    expect(getFavoriteDefaultName("/Users/test")).toBe("test");
    expect(getFavoriteDefaultName("sftp:7:/var/log/")).toBe("log");
    expect(getFavoriteDefaultName("C:\\Users\\test\\")).toBe("test");
    expect(getFavoriteDefaultName("/")).toBe("/");
});
