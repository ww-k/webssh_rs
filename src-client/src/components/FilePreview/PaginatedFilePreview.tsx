import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getSftpTextPage } from "@/api";

import MonacoTextEditor from "./MonacoTextEditor";
import PreviewState from "./previewState";

import type { IViewFileStat } from "@/types";

const PAGE_LINES = 500;

type Props = {
    file: IViewFileStat;
    lineWrapping: boolean;
};

export default function PaginatedFilePreview({ file, lineWrapping }: Props) {
    const { t } = useTranslation();
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>();
    const [pageIndex, setPageIndex] = useState(0);
    const [pageOffsets, setPageOffsets] = useState([0]);
    const [nextOffset, setNextOffset] = useState(0);
    const [hasNextPage, setHasNextPage] = useState(false);

    const loadPage = useCallback(
        async (offset: number, index = 0) => {
            setLoading(true);
            setError(undefined);
            try {
                const page = await getSftpTextPage(file.uri, {
                    offset,
                    lines: PAGE_LINES,
                });
                setContent(page.content);
                setNextOffset(page.next_offset);
                setHasNextPage(!page.eof);
                setPageIndex(index);
            } catch {
                setError(t("file_editor_load_failed"));
            } finally {
                setLoading(false);
            }
        },
        [file.uri, t],
    );

    useEffect(() => {
        setPageIndex(0);
        setPageOffsets([0]);
        void loadPage(0);
    }, [loadPage]);

    async function goNextPage() {
        if (!hasNextPage || loading) return;
        const index = pageIndex + 1;
        setPageOffsets((offsets) => [...offsets, nextOffset]);
        await loadPage(nextOffset, index);
    }

    async function goPreviousPage() {
        if (pageIndex === 0 || loading) return;
        await loadPage(pageOffsets[pageIndex - 1], pageIndex - 1);
    }

    return (
        <>
            <PreviewState loading={loading} error={error}>
                <MonacoTextEditor
                    fileName={file.name}
                    content={content}
                    lineWrapping={lineWrapping}
                    readOnly={true}
                    lineNumberOffset={pageIndex * PAGE_LINES}
                />
            </PreviewState>
            <footer className="filesviewFileEditorFooter">
                <div className="filesviewFileEditorPagination">
                    <Button
                        icon={<LeftOutlined />}
                        disabled={pageIndex === 0 || loading}
                        aria-label={t("file_editor_previous_page")}
                        title={t("file_editor_previous_page")}
                        onClick={() => void goPreviousPage()}
                    />
                    <span>{pageIndex + 1}</span>
                    <Button
                        icon={<RightOutlined />}
                        disabled={!hasNextPage || loading}
                        aria-label={t("file_editor_next_page")}
                        title={t("file_editor_next_page")}
                        onClick={() => void goNextPage()}
                    />
                </div>
                <span />
            </footer>
        </>
    );
}
