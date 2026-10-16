import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import CodeMirror from "@uiw/react-codemirror";
import { Button, Spin } from "antd";
import { useEffect, useState } from "react";

import { getSftpDownload, postSftpUpload } from "@/api";

import type { Extension } from "@codemirror/state";
import type { IViewFileStat } from "@/types";

import "./FileEditorPanel.css";

type Props = {
    file: IViewFileStat;
    onClose: () => void;
};

export default function FileEditorPanel({ file, onClose }: Props) {
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
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
                if (!disposed) setError("加载文件失败");
            })
            .finally(() => {
                if (!disposed) setLoading(false);
            });
        return () => {
            disposed = true;
        };
    }, [file.uri]);

    async function save() {
        setSaving(true);
        setError(undefined);
        try {
            await postSftpUpload(
                file.uri,
                new Blob([content], { type: "text/plain;charset=utf-8" }),
            );
        } catch {
            setError("保存文件失败");
        } finally {
            setSaving(false);
        }
    }

    return (
        <section
            className="filesviewFileEditor"
            aria-label={`编辑 ${file.name}`}
        >
            <header className="filesviewFileEditorHeader">
                <strong title={file.name}>{file.name}</strong>
                <div className="filesviewFileEditorActions">
                    <Button
                        type="primary"
                        loading={saving}
                        disabled={loading || Boolean(error)}
                        onClick={save}
                    >
                        保存
                    </Button>
                    <Button onClick={onClose}>关闭</Button>
                </div>
            </header>
            <div className="filesviewFileEditorBody">
                {loading ? (
                    <div className="filesviewFileEditorState">
                        <Spin tip="加载中..." />
                    </div>
                ) : error ? (
                    <div className="filesviewFileEditorState">{error}</div>
                ) : (
                    <CodeMirror
                        aria-label={file.name}
                        value={content}
                        height="100%"
                        extensions={getLanguageExtensions(file.name)}
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
