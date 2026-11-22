import { FilterOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Input from "@/components/Input";

import { parseTailEvent } from "./fileContent";
import MonacoTextEditor from "./MonacoTextEditor";
import PreviewState from "./previewState";

import type { IViewFileStat } from "@/types";

const MAX_TAIL_TEXT_BYTES = 2 * 1024 * 1024;

type Props = {
    file: IViewFileStat;
    lineWrapping: boolean;
};

export default function TailFilePreview({ file, lineWrapping }: Props) {
    const { t } = useTranslation();
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>();
    const [filter, setFilter] = useState("");
    const filteredContent = useMemo(
        () => filterTailContent(content, filter),
        [content, filter],
    );

    useEffect(() => {
        let disposed = false;
        const eventSource = new EventSource(
            `/api/sftp/tailf?uri=${encodeURIComponent(file.uri)}`,
        );
        const replaceContent = (event: Event) => {
            if (disposed) return;
            setContent(parseTailEvent(event));
            setLoading(false);
        };
        const appendContent = (event: Event) => {
            if (disposed) return;
            setContent((previous) =>
                trimTailContent(previous + parseTailEvent(event)),
            );
            setLoading(false);
        };
        const reportError = () => {
            if (!disposed) setError(t("file_editor_load_failed"));
        };
        eventSource.addEventListener("snapshot", replaceContent);
        eventSource.addEventListener("append", appendContent);
        eventSource.addEventListener("error", reportError);
        eventSource.onerror = () => {
            if (eventSource.readyState === EventSource.CLOSED) reportError();
        };
        return () => {
            disposed = true;
            eventSource.close();
            eventSource.removeEventListener("snapshot", replaceContent);
            eventSource.removeEventListener("append", appendContent);
            eventSource.removeEventListener("error", reportError);
        };
    }, [file.uri, t]);

    return (
        <>
            <PreviewState loading={loading} error={error}>
                <MonacoTextEditor
                    fileName={file.name}
                    content={filteredContent}
                    lineWrapping={lineWrapping}
                    readOnly={true}
                    followTail={true}
                    showLineNumbers={false}
                    highlightText={filter}
                />
            </PreviewState>
            <footer className="filesviewFileEditorFooter">
                <Input
                    allowClear={true}
                    aria-label={t("file_editor_tail_filter")}
                    className="filesviewFileEditorFilter"
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder={t("file_editor_tail_filter")}
                    prefix={<FilterOutlined />}
                    value={filter}
                />
                <span />
            </footer>
        </>
    );
}

function trimTailContent(content: string) {
    if (content.length <= MAX_TAIL_TEXT_BYTES) return content;
    const trimStart = content.length - MAX_TAIL_TEXT_BYTES;
    const lineStart = content.indexOf("\n", trimStart);
    return content.slice(lineStart < 0 ? trimStart : lineStart + 1);
}

function filterTailContent(content: string, filter: string) {
    if (!filter) return content;
    const hasTrailingNewline = content.endsWith("\n");
    const lines = content
        .split(/\r?\n/)
        .filter((line) => line.includes(filter));
    return `${lines.join("\n")}${hasTrailingNewline && lines.length ? "\n" : ""}`;
}
