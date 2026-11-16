import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

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

    useEffect(() => {
        let disposed = false;
        const eventSource = new EventSource(
            `/api/sftp/tail?uri=${encodeURIComponent(file.uri)}`,
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
            if (!disposed) setError(t("file_editor_tail_failed"));
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
                    content={content}
                    lineWrapping={lineWrapping}
                    readOnly={true}
                    followTail={true}
                    showLineNumbers={false}
                />
            </PreviewState>
            <footer className="filesviewFileEditorFooter">
                <span />
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
