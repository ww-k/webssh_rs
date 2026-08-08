import { expect, test } from "@rstest/core";

import Pathbar from ".";

function createPathbar(onChange?: (path: string) => void) {
    return new Pathbar({
        cwd: "sftp:7:/home/test",
        history: [],
        getCwdFiles: () => {},
        onChange,
    });
}

function makeStateUpdatesSynchronous(pathbar: Pathbar) {
    pathbar.setState = ((
        update:
            | object
            | ((state: typeof pathbar.state) => Partial<typeof pathbar.state>),
    ) => {
        const nextState =
            typeof update === "function" ? update(pathbar.state) : update;
        Object.assign(pathbar.state, nextState);
    }) as unknown as typeof pathbar.setState;
}

test("[Pathbar] rejects stale favorite directory request identities", () => {
    const pathbar = createPathbar();
    pathbar.favoriteDirectoryListRequestId = 3;
    pathbar.favoriteDirectoryMutationRequestId = 5;

    expect(pathbar.isFavoriteDirectoryListRequestCurrent(1, 7)).toBe(false);
    expect(pathbar.isFavoriteDirectoryListRequestCurrent(3, 7)).toBe(true);
    expect(pathbar.isFavoriteDirectoryListRequestCurrent(3, 8)).toBe(false);
    expect(pathbar.isFavoriteDirectoryMutationRequestCurrent(4, 7)).toBe(false);
    expect(pathbar.isFavoriteDirectoryMutationRequestCurrent(5, 7)).toBe(true);
});

test("[Pathbar] favorite directory button always toggles the menu", () => {
    let pathChangeCount = 0;
    const pathbar = createPathbar(() => {
        pathChangeCount += 1;
    });
    makeStateUpdatesSynchronous(pathbar);
    Object.assign(pathbar.state, {
        favoriteDirectories: [
            {
                name: "Home",
                path: "sftp:7:/home/test",
                isDefault: true,
            },
        ],
    });

    const event = { stopPropagation: () => {} } as React.MouseEvent;
    pathbar.btnFavoriteDirectoryMenuClickHandle(event);
    expect(pathbar.state.favoriteDirectoryMenuVisible).toBe(true);
    expect(pathChangeCount).toBe(0);

    pathbar.btnFavoriteDirectoryMenuClickHandle(event);
    expect(pathbar.state.favoriteDirectoryMenuVisible).toBe(false);
    expect(pathChangeCount).toBe(0);
});
