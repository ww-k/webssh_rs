import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { Button, Spin, Switch } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getSftpDownload, postSftpUpload } from "@/api";

import type { Extension } from "@codemirror/state";
import type { IViewFileStat } from "@/types";

import "./FileEditorPanel.css";

type Props = {
    file: IViewFileStat;
    onClose: () => void;
};

export default function FileEditorPanel({ file, onClose }: Props) {
    const { t } = useTranslation();
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [lineWrapping, setLineWrapping] = useState(true);
    const [error, setError] = useState<string>();

    useEffect(() => {
        let disposed = false;
        setLoading(true);
        setError(undefined);
        getSftpDownload(file.uri)
            .then((response) => response.text())
            .then((text) => {
                if (!disposed) setContent(text);
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

    async function save() {
        setSaving(true);
        setError(undefined);
        try {
            await postSftpUpload(
                file.uri,
                new Blob([content], { type: "text/plain;charset=utf-8" }),
            );
        } catch {
            setError(t("file_editor_save_failed"));
        } finally {
            setSaving(false);
        }
    }

    return (
        <section
            className="filesviewFileEditor"
            aria-label={t("file_editor_aria_label", { name: file.name })}
        >
            <header className="filesviewFileEditorHeader">
                <strong title={file.name}>{file.name}</strong>
                <div className="filesviewFileEditorActions">
                    <label className="filesviewFileEditorWrapToggle">
                        <span>{t("file_editor_line_wrap")}</span>
                        <Switch
                            size="small"
                            checked={lineWrapping}
                            onChange={setLineWrapping}
                            aria-label={t("file_editor_line_wrap")}
                        />
                    </label>
                    <Button
                        type="primary"
                        loading={saving}
                        disabled={loading || Boolean(error)}
                        onClick={save}
                    >
                        {t("app_btn_save")}
                    </Button>
                    <Button onClick={onClose}>{t("app_btn_cancel")}</Button>
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
                    <CodeMirror
                        aria-label={file.name}
                        value={content}
                        height="100%"
                        extensions={
                            lineWrapping
                                ? [
                                      ...getLanguageExtensions(file.name),
                                      EditorView.lineWrapping,
                                  ]
                                : getLanguageExtensions(file.name)
                        }
                        onChange={setContent}
                        basicSetup={{
                            foldGutter: true,
                            highlightActiveLine: true,
                            bracketMatching: true,
                            autocompletion: true,
                        }}
                    />
                )}
            </div>
        </section>
    );
}

function getLanguageExtensions(fileName: string): Extension[] {
    const name = fileName.toLowerCase();
    if (name.endsWith(".json") || name.endsWith(".jsonc")) return [json()];
    if (name.endsWith(".yaml") || name.endsWith(".yml")) return [yaml()];
    if (name.endsWith(".xml")) return [xml()];
    if (name.endsWith(".py")) return [python()];
    return [];
}
