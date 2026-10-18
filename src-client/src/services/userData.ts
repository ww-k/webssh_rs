import {
    getFavoriteDirectoryList,
    getTargetList,
    postFavoriteDirectoryAdd,
    postTargetAdd,
    postTargetUpdate,
} from "@/api";

import type { ITarget } from "@/api";
import type { ThemeMode } from "@/store";

export const USER_DATA_VERSION = 1;

export interface UserDataExport {
    version: typeof USER_DATA_VERSION;
    exported_at: string;
    targets: ITarget[];
    favorite_directories: Array<{
        target_id: number;
        name: string;
        path: string;
        is_default?: boolean;
    }>;
    settings: {
        theme_mode: ThemeMode;
        sidebar_collapsed: boolean;
        language: string;
    };
}

export interface UserDataImportResult {
    addedTargets: number;
    skippedTargets: number;
    importedFavorites: number;
    settings: UserDataExport["settings"];
}

function targetKey(target: Pick<ITarget, "host" | "port" | "method" | "user">) {
    return [
        target.host.trim().toLocaleLowerCase(),
        target.port || 22,
        target.method,
        target.user.trim(),
    ].join("\u0000");
}

export async function createUserDataExport(
    settings: UserDataExport["settings"],
) {
    const targets = await getTargetList();
    const favoriteResults = await Promise.allSettled([
        getFavoriteDirectoryList(0),
        ...targets.map((target) => getFavoriteDirectoryList(target.id)),
    ]);
    const favoriteDirectories: UserDataExport["favorite_directories"] = [];

    favoriteResults.forEach((result, index) => {
        if (result.status !== "fulfilled") return;
        const targetId = index === 0 ? 0 : targets[index - 1].id;
        for (const directory of result.value) {
            if (directory.is_default) continue;
            favoriteDirectories.push({
                target_id: targetId,
                name: directory.name,
                path: directory.path,
                is_default: directory.is_default,
            });
        }
    });

    return {
        version: USER_DATA_VERSION,
        exported_at: new Date().toISOString(),
        targets,
        favorite_directories: favoriteDirectories,
        settings,
    } satisfies UserDataExport;
}

function isTarget(value: unknown): value is ITarget {
    if (!value || typeof value !== "object") return false;
    const target = value as Partial<ITarget>;
    return (
        typeof target.id === "number" &&
        typeof target.host === "string" &&
        typeof target.user === "string" &&
        typeof target.method === "number"
    );
}

function readImport(value: unknown): UserDataExport {
    if (!value || typeof value !== "object") {
        throw new Error("Invalid user data file");
    }
    const data = value as Partial<UserDataExport>;
    if (data.version !== USER_DATA_VERSION || !Array.isArray(data.targets)) {
        throw new Error("Unsupported user data file");
    }
    const targets = data.targets.filter(isTarget);
    if (targets.length !== data.targets.length) {
        throw new Error("Invalid target data");
    }
    const favoriteDirectories = Array.isArray(data.favorite_directories)
        ? data.favorite_directories.filter(
              (directory) =>
                  directory &&
                  typeof directory.target_id === "number" &&
                  typeof directory.name === "string" &&
                  typeof directory.path === "string",
          )
        : [];
    const settings = data.settings;
    const validSettings =
        settings &&
        (settings.theme_mode === "light" ||
            settings.theme_mode === "dark" ||
            settings.theme_mode === "system") &&
        typeof settings.sidebar_collapsed === "boolean" &&
        (settings.language === "zh" || settings.language === "en")
            ? settings
            : {
                  theme_mode: "system" as const,
                  sidebar_collapsed: true,
                  language: "zh",
              };
    return {
        version: USER_DATA_VERSION,
        exported_at:
            typeof data.exported_at === "string"
                ? data.exported_at
                : new Date().toISOString(),
        targets,
        favorite_directories: favoriteDirectories,
        settings: validSettings,
    };
}

export async function importUserData(
    raw: unknown,
): Promise<UserDataImportResult> {
    const data = readImport(raw);
    const currentTargets = await getTargetList();
    const targetIds = new Map<number, number>();
    const existingByKey = new Map(
        currentTargets.map((target) => [targetKey(target), target]),
    );
    let addedTargets = 0;
    let skippedTargets = 0;
    const added: Array<{ source: ITarget; target: ITarget }> = [];

    for (const source of data.targets) {
        const existing = existingByKey.get(targetKey(source));
        if (existing) {
            targetIds.set(source.id, existing.id);
            skippedTargets += 1;
            continue;
        }

        try {
            const created = await postTargetAdd({
                ...source,
                id: undefined,
                jump_host_id: undefined,
            } as Omit<ITarget, "id">);
            const target = created;
            targetIds.set(source.id, target.id);
            existingByKey.set(targetKey(source), target);
            added.push({ source, target });
            addedTargets += 1;
        } catch {
            skippedTargets += 1;
        }
    }

    for (const { source, target } of added) {
        const jumpHostId =
            source.jump_host_id === undefined || source.jump_host_id === null
                ? undefined
                : targetIds.get(source.jump_host_id);
        if (jumpHostId === undefined) continue;
        try {
            await postTargetUpdate({ ...target, jump_host_id: jumpHostId });
        } catch {
            // The target remains usable without its optional jump host.
        }
    }

    const favoriteResults = await Promise.allSettled(
        Array.from(new Set([0, ...targetIds.values()])).map((targetId) =>
            getFavoriteDirectoryList(targetId),
        ),
    );
    const existingFavorites = new Map<number, Set<string>>();
    favoriteResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
            existingFavorites.set(
                Array.from(new Set([0, ...targetIds.values()]))[index],
                new Set(result.value.map((item) => item.path)),
            );
        }
    });

    let importedFavorites = 0;
    for (const directory of data.favorite_directories) {
        const targetId =
            directory.target_id === 0 ? 0 : targetIds.get(directory.target_id);
        if (targetId === undefined || !directory.path || !directory.name)
            continue;
        const paths = existingFavorites.get(targetId) ?? new Set<string>();
        if (paths.has(directory.path)) continue;
        try {
            await postFavoriteDirectoryAdd({
                target_id: targetId,
                name: directory.name,
                path: directory.path,
            });
            paths.add(directory.path);
            existingFavorites.set(targetId, paths);
            importedFavorites += 1;
        } catch {
            // Keep importing the remaining directories.
        }
    }

    return {
        addedTargets,
        skippedTargets,
        importedFavorites,
        settings: data.settings,
    };
}
