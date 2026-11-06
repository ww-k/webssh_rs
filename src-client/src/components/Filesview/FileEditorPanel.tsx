import {
    CloseOutlined,
    ColumnWidthOutlined,
    EnterOutlined,
} from "@ant-design/icons";
import { Button, message, Spin } from "antd";

import * as monaco from "../../../node_modules/monaco-editor/esm/vs/editor/editor.api.js";
import "../../../node_modules/monaco-editor/esm/vs/editor/editor.main.js";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { getSftpDownload, postSftpUpload } from "@/api";
import useAppStore from "@/store";

import type { IViewFileStat } from "@/types";

import "./FileEditorPanel.css";

type Props = {
    file: IViewFileStat;
    onClose: () => void;
};

type MonacoEnvironment = {
    getWorker: (workerId: string, label: string) => Worker;
};

configureMonacoWorkers();

export default function FileEditorPanel({ file, onClose }: Props) {
    const { t } = useTranslation();
    const theme = useAppStore((state) => state.theme);
    const terminalScrollbarThumb = useAppStore(
        (state) => state.terminalThemes[state.theme].scrollbarThumb,
    );
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [lineWrapping, setLineWrapping] = useState(true);
    const [expanded, setExpanded] = useState(false);
    const [error, setError] = useState<string>();
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>();
    const contentRef = useRef("");

    useEffect(() => {
        let disposed = false;
        setLoading(true);
        setError(undefined);
        setExpanded(false);
        getSftpDownload(file.uri)
            .then((response) => response.text())
            .then((text) => {
                if (!disposed) {
                    contentRef.current = text;
                }
            })
            .catch(() => {
                if (!disposed) setError(t("file_editor_load_failed"));
            })
            .finally(() => {
                if (!disposed) setLoading(false);
            });
        return () => {
            disposed = true;
        };
    }, [file.uri, t]);

    useEffect(() => {
        if (loading || error || !editorContainerRef.current) return;

        const model = monaco.editor.createModel(
            contentRef.current,
            getLanguage(file.name),
        );
        const editor = monaco.editor.create(editorContainerRef.current, {
            ariaLabel: file.name,
            automaticLayout: true,
            bracketPairColorization: { enabled: true },
            folding: true,
            fontSize: 14,
            lineNumbers: "on",
            minimap: { enabled: false },
            model,
            scrollBeyondLastLine: false,
            scrollbar: {
                horizontalScrollbarSize: 10,
                useShadows: false,
                verticalScrollbarSize: 10,
            },
            tabSize: 4,
            wordWrap: "on",
        });
        editorRef.current = editor;

        const contentSubscription = editor.onDidChangeModelContent(() => {
            const value = editor.getValue();
            contentRef.current = value;
        });

        return () => {
            contentSubscription.dispose();
            editor.dispose();
            model.dispose();
            editorRef.current = undefined;
        };
    }, [error, file.name, loading]);

    useEffect(() => {
        editorRef.current?.updateOptions({
            wordWrap: lineWrapping ? "on" : "off",
        });
    }, [lineWrapping]);

    useEffect(() => {
        monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
    }, [theme]);

    async function save() {
        setSaving(true);
        setError(undefined);
        try {
            const value = editorRef.current?.getValue() ?? contentRef.current;
            await postSftpUpload(
                file.uri,
                new Blob([value], { type: "text/plain;charset=utf-8" }),
            );
            message.success(t("file_editor_save_success"));
        } catch {
            setError(t("file_editor_save_failed"));
        } finally {
            setSaving(false);
        }
    }

    return (
        <section
            className={`filesviewFileEditor${expanded ? " filesviewFileEditorExpanded" : ""}`}
            aria-label={t("file_editor_aria_label", { name: file.name })}
            style={
                {
                    "--webssh-scrollbar-thumb": terminalScrollbarThumb,
                } as React.CSSProperties
            }
        >
            <header className="filesviewFileEditorHeader">
                <strong title={file.name}>{file.name}</strong>
                <div className="filesviewFileEditorActions">
                    <Button
                        type={lineWrapping ? "default" : "text"}
                        icon={<EnterOutlined />}
                        aria-label={t("file_editor_line_wrap")}
                        aria-pressed={lineWrapping}
                        title={t("file_editor_line_wrap")}
                        onClick={() => setLineWrapping((value) => !value)}
                    />
                    <Button
                        type={expanded ? "default" : "text"}
                        icon={<ColumnWidthOutlined />}
                        aria-label={t(
                            expanded
                                ? "file_editor_collapse"
                                : "file_editor_expand",
                        )}
                        title={t(
                            expanded
                                ? "file_editor_collapse"
                                : "file_editor_expand",
                        )}
                        onClick={() => setExpanded((value) => !value)}
                    />
                    <Button
                        type="text"
                        icon={<CloseOutlined />}
                        aria-label={t("app_btn_cancel")}
                        title={t("app_btn_cancel")}
                        onClick={onClose}
                    />
                </div>
            </header>
            <div className="filesviewFileEditorBody">
                {loading ? (
                    <div className="filesviewFileEditorState">
                        <Spin tip={t("file_editor_loading")} />
                    </div>
                ) : error ? (
                    <div className="filesviewFileEditorState">{error}</div>
                ) : (
                    <div
                        ref={editorContainerRef}
                        className="filesviewFileEditorMonaco"
                        aria-label={file.name}
                    />
                )}
            </div>
            <footer className="filesviewFileEditorFooter">
                <div className="filesviewFileEditorActions">
                    <Button
                        type="primary"
                        loading={saving}
                        disabled={loading || Boolean(error)}
                        onClick={save}
                        aria-label={t("app_btn_save")}
                        title={t("app_btn_save")}
                    >
                        {t("app_btn_save")}
                    </Button>
                </div>
            </footer>
        </section>
    );
}

function configureMonacoWorkers() {
    const global = globalThis as typeof globalThis & {
        MonacoEnvironment?: MonacoEnvironment;
    };
    if (global.MonacoEnvironment) return;

    global.MonacoEnvironment = {
        getWorker(_workerId, label) {
            if (label === "json") {
                return new Worker(
                    new URL(
                        "../../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js",
                        import.meta.url,
                    ),
                    { type: "module" },
                );
            }
            return new Worker(
                new URL(
                    "../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js",
                    import.meta.url,
                ),
                { type: "module" },
            );
        },
    };
}

function getLanguage(fileName: string): string | undefined {
    const name = fileName.toLowerCase();
    if (name.endsWith(".json") || name.endsWith(".jsonc")) return "json";
    if (name.endsWith(".yaml") || name.endsWith(".yml")) return "yaml";
    if (name.endsWith(".xml")) return "xml";
    if (name.endsWith(".py")) return "python";
    return undefined;
}
