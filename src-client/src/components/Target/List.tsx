import {
    CodeOutlined,
    DeleteOutlined,
    EditOutlined,
    FolderOpenOutlined,
    FolderOutlined,
    LinuxOutlined,
    PlusCircleTwoTone,
    ReloadOutlined,
    SearchOutlined,
    WindowsOutlined,
} from "@ant-design/icons";
import { Button, Input, Modal, message, Select, Space, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
    getTargetList,
    postTargetRemove,
    postTargetReorder,
    postTargetUpdate,
} from "@/api";
import DataTable, {
    type DataTableColumn,
    type DataTableDropEvent,
} from "@/components/DataTable";
import useTablePageNavigation from "@/hooks/useTablePageNavigation";
import useAppStore from "@/store";

import "./List.css";

import TargetEditor from "./Editor";
import getTargetName from "./getTargetName";

import type { ITarget } from "@/api";
import type { ITab } from "@/store";

type TargetDirectoryRow = {
    id: string;
    name: string;
    directory: string;
    host: string;
    user: string;
    method: number;
    isDirectory: true;
    children: ITarget[];
};
type TargetTreeRow =
    | (ITarget & {
          children?: ITarget[];
          isDirectory?: false;
      })
    | TargetDirectoryRow;

const TARGET_ROW_HEIGHT = 33;

const normalizeDirectory = (directory?: string) =>
    directory?.trim().replace(/^\/+|\/+$/g, "") || "";

const sortTargets = (targets: ITarget[]) =>
    [...targets].sort(
        (left, right) =>
            (left.sort_order ?? 0) - (right.sort_order ?? 0) ||
            left.id - right.id,
    );

const buildTargetTree = (targets: ITarget[]): TargetTreeRow[] => {
    const grouped = new Map<string, ITarget[]>();
    const standalone: ITarget[] = [];

    for (const target of targets) {
        const directory = normalizeDirectory(target.directory);
        if (!directory) {
            standalone.push({ ...target });
            continue;
        }
        const group = grouped.get(directory) || [];
        group.push(target);
        grouped.set(directory, group);
    }

    const directories: TargetDirectoryRow[] = [...grouped.entries()].map(
        ([directory, children]) => ({
            id: `target-directory:${directory}`,
            name: directory,
            directory,
            host: "",
            user: "",
            method: 3,
            isDirectory: true as const,
            children: sortTargets(children).map((target) => ({ ...target })),
        }),
    );

    const orderedDirectories = directories
        .map((row, index) => ({
            row,
            order: Math.min(
                ...(row.children ?? []).map(
                    (child) => child.sort_order ?? Number.MAX_SAFE_INTEGER,
                ),
            ),
            index,
        }))
        .sort(
            (left, right) =>
                left.order - right.order || left.index - right.index,
        )
        .map(({ row }) => row);

    return [...orderedDirectories, ...sortTargets(standalone)];
};

const rootGroupKey = (row: TargetTreeRow) =>
    row.isDirectory || normalizeDirectory(row.directory)
        ? normalizeDirectory(row.directory)
        : `target:${row.id}`;

const TargetTreeExpandIcon = (
    record: TargetTreeRow,
    expanded: boolean,
    onToggle: () => void,
) => {
    if (!record.isDirectory) {
        const SystemIcon =
            record.system?.toLocaleLowerCase() === "windows"
                ? WindowsOutlined
                : LinuxOutlined;
        return (
            <span
                className="targetTreeExpandIcon targetTreeExpandIconTarget"
                aria-label={record.system || "Linux"}
            >
                <SystemIcon aria-hidden="true" />
            </span>
        );
    }
    return (
        <button
            type="button"
            className="targetTreeExpandIcon targetTreeExpandIconDirectory"
            aria-expanded={expanded}
            aria-label={record.name}
            onClick={(event) => {
                event.stopPropagation();
                onToggle();
            }}
        >
            {expanded ? <FolderOpenOutlined /> : <FolderOutlined />}
        </button>
    );
};

export default function TargetList({ tab }: { tab: ITab }) {
    const { t } = useTranslation();
    const setTabPath = useAppStore((state) => state.setTabPath);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorData, setEditorData] = useState<ITarget>();
    const [dataSource, setDataSource] = useState<ITarget[]>([]);
    const [searchValue, setSearchValue] = useState("");
    const [directoryFilter, setDirectoryFilter] = useState<string>();
    const getTargetRowId = useCallback(
        (row: TargetTreeRow) => String(row.id),
        [],
    );
    const getTargetSubRows = useCallback(
        (row: TargetTreeRow) => row.children,
        [],
    );
    const { tableContainerRef, tablePageNavigationProps } =
        useTablePageNavigation();
    const [tableBodyHeight, setTableBodyHeight] = useState(0);

    const filteredDataSource = useMemo(() => {
        const search = searchValue.trim().toLocaleLowerCase();
        return dataSource.filter((target) => {
            if (
                directoryFilter &&
                normalizeDirectory(target.directory) !== directoryFilter
            ) {
                return false;
            }
            if (!search) return true;
            return [
                target.directory,
                target.name,
                target.user,
                target.host,
            ].some((value) => value?.toLocaleLowerCase().includes(search));
        });
    }, [dataSource, directoryFilter, searchValue]);

    const refresh = useCallback(async () => {
        const res = await getTargetList();
        setDataSource(res);
    }, []);

    const handleDrop = useCallback(
        async ({
            rows,
            target,
            dropPosition,
        }: DataTableDropEvent<TargetTreeRow>) => {
            const sourceDirectoryRows = rows.filter(
                (row): row is TargetDirectoryRow => Boolean(row.isDirectory),
            );
            const sourceDirectoryKeys = new Set(
                sourceDirectoryRows.map((row) =>
                    normalizeDirectory(row.directory),
                ),
            );
            const sourceRows = [
                ...rows.filter((row): row is ITarget => !row.isDirectory),
                ...dataSource.filter((row) =>
                    sourceDirectoryKeys.has(normalizeDirectory(row.directory)),
                ),
            ].filter(
                (row, index, all) =>
                    all.findIndex((candidate) => candidate.id === row.id) ===
                    index,
            );
            if (sourceRows.length === 0) return;
            const sourceIds = new Set(sourceRows.map((row) => row.id));

            if (sourceDirectoryRows.length > 0) {
                const rootRows = buildTargetTree(dataSource);
                const sourceRootRows = rootRows.filter((row) =>
                    sourceDirectoryKeys.has(
                        row.isDirectory
                            ? normalizeDirectory(row.directory)
                            : "",
                    ),
                );
                if (sourceRootRows.length === 0) {
                    return;
                }
                const remainingRootRows = rootRows.filter(
                    (row) => !sourceRootRows.includes(row),
                );
                if (target) {
                    const targetKey = rootGroupKey(target);
                    if (sourceDirectoryKeys.has(targetKey)) return;
                    const targetIndex = remainingRootRows.findIndex(
                        (row) => rootGroupKey(row) === targetKey,
                    );
                    if (targetIndex < 0) return;
                    remainingRootRows.splice(
                        targetIndex + (dropPosition === "after" ? 1 : 0),
                        0,
                        ...sourceRootRows,
                    );
                } else {
                    remainingRootRows.push(...sourceRootRows);
                }
                const orderedIds = remainingRootRows.flatMap((row) =>
                    row.isDirectory
                        ? sortTargets(row.children ?? []).map(
                              (child) => child.id,
                          )
                        : [row.id],
                );
                try {
                    await postTargetReorder(orderedIds);
                    await refresh();
                } catch {
                    message.error(t("target_move_failed"));
                    await refresh();
                }
                return;
            }

            if (target && !target.isDirectory && sourceIds.has(target.id)) {
                return;
            }
            const directory = normalizeDirectory(target?.directory);
            const nextTargets = dataSource.map((row) => ({ ...row }));
            const targetsByDirectory = new Map<string, ITarget[]>();
            for (const row of nextTargets) {
                if (sourceIds.has(row.id)) {
                    row.directory = directory;
                }
                const key = normalizeDirectory(row.directory);
                const group = targetsByDirectory.get(key) ?? [];
                group.push(row);
                targetsByDirectory.set(key, group);
            }

            const targetGroup = sortTargets(
                targetsByDirectory.get(directory) ?? [],
            ).filter((row) => !sourceIds.has(row.id));
            const sourceTargets = sourceRows.map((row) => ({
                ...row,
                directory,
            }));
            let insertionIndex = targetGroup.length;
            if (target && !target.isDirectory) {
                const targetIndex = targetGroup.findIndex(
                    (row) => row.id === target.id,
                );
                if (targetIndex >= 0) {
                    insertionIndex =
                        targetIndex + (dropPosition === "after" ? 1 : 0);
                }
            }
            targetGroup.splice(insertionIndex, 0, ...sourceTargets);

            const orderedIds: number[] = [];
            let ungroupedAdded = false;
            for (const rootRow of buildTargetTree(dataSource)) {
                if (rootRow.isDirectory) {
                    const groupDirectory = normalizeDirectory(
                        rootRow.directory,
                    );
                    const group =
                        groupDirectory === directory
                            ? targetGroup
                            : sortTargets(
                                  targetsByDirectory.get(groupDirectory) ?? [],
                              ).filter((row) => !sourceIds.has(row.id));
                    orderedIds.push(...group.map((row) => row.id));
                } else if (!ungroupedAdded) {
                    ungroupedAdded = true;
                    const group =
                        directory === ""
                            ? targetGroup
                            : sortTargets(
                                  targetsByDirectory.get("") ?? [],
                              ).filter((row) => !sourceIds.has(row.id));
                    orderedIds.push(...group.map((row) => row.id));
                }
            }
            if (!ungroupedAdded) {
                const group =
                    directory === ""
                        ? targetGroup
                        : sortTargets(targetsByDirectory.get("") ?? []).filter(
                              (row) => !sourceIds.has(row.id),
                          );
                orderedIds.push(...group.map((row) => row.id));
            }

            try {
                await Promise.all(
                    sourceTargets
                        .filter(
                            (row) =>
                                normalizeDirectory(
                                    sourceRows.find(
                                        (source) => source.id === row.id,
                                    )?.directory,
                                ) !== directory,
                        )
                        .map((row) => postTargetUpdate(row)),
                );
                await postTargetReorder(orderedIds);
                await refresh();
            } catch {
                message.error(t("target_move_failed"));
                await refresh();
            }
        },
        [dataSource, refresh, t],
    );

    const treeDataSource = useMemo(
        () => buildTargetTree(filteredDataSource),
        [filteredDataSource],
    );
    const directoryOptions = useMemo(
        () =>
            [
                ...new Set(
                    dataSource
                        .map((target) => normalizeDirectory(target.directory))
                        .filter(Boolean),
                ),
            ]
                .sort((left, right) => left.localeCompare(right))
                .map((directory) => ({ label: directory, value: directory })),
        [dataSource],
    );

    const columns: DataTableColumn<TargetTreeRow>[] = useMemo(
        () => [
            {
                id: "name",
                header: t("target_directory"),
                accessor: (record) => record.name,
                width: 300,
                sortable: false,
                cell: (_value, record) =>
                    record.isDirectory
                        ? `${record.name}`
                        : getTargetName(record),
            },
            {
                id: "action",
                header: t("app_common_action"),
                accessor: () => "",
                width: 180,
                sortable: false,
                cell: (_value, record) =>
                    record.isDirectory ? null : (
                        <Space size="small">
                            <Tooltip title="SSH">
                                <Button
                                    aria-label="SSH"
                                    icon={<CodeOutlined />}
                                    type="text"
                                    onClick={() => {
                                        setTabPath(
                                            tab.key,
                                            `/terminal/${record.id}`,
                                            `${getTargetName(record)}`,
                                        );
                                    }}
                                />
                            </Tooltip>
                            <Tooltip title="SFTP">
                                <Button
                                    aria-label="SFTP"
                                    icon={<FolderOutlined />}
                                    type="text"
                                    onClick={() => {
                                        setTabPath(
                                            tab.key,
                                            `/filesview/${record.id}`,
                                            `${getTargetName(record)}`,
                                        );
                                    }}
                                />
                            </Tooltip>
                            <Tooltip title={t("app_btn_edit")}>
                                <Button
                                    aria-label={t("app_btn_edit")}
                                    icon={<EditOutlined />}
                                    type="text"
                                    onClick={() => {
                                        setEditorData(record);
                                        setEditorOpen(true);
                                        refresh();
                                    }}
                                />
                            </Tooltip>
                            <Tooltip title={t("app_btn_delete")}>
                                <Button
                                    aria-label={t("app_btn_delete")}
                                    danger
                                    icon={<DeleteOutlined />}
                                    type="text"
                                    onClick={() => {
                                        Modal.confirm({
                                            content: "Confirm to delete?",
                                            async onOk() {
                                                await postTargetRemove(
                                                    record.id,
                                                );
                                                await refresh();
                                            },
                                        });
                                    }}
                                />
                            </Tooltip>
                        </Space>
                    ),
            },
        ],
        [refresh, setTabPath, t, tab.key],
    );

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        const handler = () => void refresh();
        window.addEventListener("webssh:user-data-imported", handler);
        return () =>
            window.removeEventListener("webssh:user-data-imported", handler);
    }, [refresh]);

    useEffect(() => {
        const element = tableContainerRef.current;
        if (!element) return;

        const updateTableHeight = () => {
            setTableBodyHeight(Math.max(element.clientHeight - 38, 160));
        };
        updateTableHeight();

        const observer = new ResizeObserver(updateTableHeight);
        observer.observe(element);
        return () => observer.disconnect();
    }, [tableContainerRef]);

    return (
        <>
            <div className="WebSSH-MenuPageToolbar targetListToolbar">
                <Select
                    allowClear
                    className="targetListDirectoryFilter"
                    aria-label={t("target_directory_filter")}
                    options={directoryOptions}
                    placeholder={t("target_directory_filter")}
                    showSearch
                    value={directoryFilter}
                    onChange={(value) => setDirectoryFilter(value)}
                    getPopupContainer={(trigger) =>
                        trigger.parentElement ?? document.body
                    }
                />
                <Input
                    allowClear
                    aria-label={t("transfer_filter_keyword")}
                    className="WebSSH-TransferKeyword targetListSearch"
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder={t("transfer_filter_keyword")}
                    prefix={<SearchOutlined />}
                    value={searchValue}
                />
                <Space className="targetListActions" size="small">
                    <Tooltip title={t("target_new")}>
                        <Button
                            icon={<PlusCircleTwoTone />}
                            onClick={() => {
                                setEditorData(undefined);
                                setEditorOpen(true);
                            }}
                        />
                    </Tooltip>
                    <Tooltip title={t("app_btn_refresh")}>
                        <Button
                            aria-label={t("app_btn_refresh")}
                            icon={<ReloadOutlined />}
                            onClick={refresh}
                            title={t("app_btn_refresh")}
                        />
                    </Tooltip>
                </Space>
            </div>
            <div
                ref={tableContainerRef}
                className="WebSSH-MenuPageContent targetListTableContainer"
                {...tablePageNavigationProps}
            >
                <DataTable
                    className="targetListTable"
                    columns={columns}
                    data={treeDataSource}
                    getRowId={getTargetRowId}
                    getSubRows={getTargetSubRows}
                    canDropRow={() => true}
                    showDropIndicator={() => true}
                    defaultExpanded
                    draggable
                    expandIcon={TargetTreeExpandIcon}
                    onDrop={handleDrop}
                    rowHeight={TARGET_ROW_HEIGHT}
                    multiple={false}
                    virtual={tableBodyHeight > 0}
                />
            </div>
            <TargetEditor
                open={editorOpen}
                data={editorData}
                onOk={() => {
                    refresh();
                    setEditorOpen(false);
                }}
                onCancel={() => setEditorOpen(false)}
            />
        </>
    );
}
