import { message } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { postSftpUpload } from "@/api";
import Button from "@/components/Button";

import { loadFileContent } from "./fileContent";
import MonacoTextEditor from "./MonacoTextEditor";
import PreviewState from "./previewState";

import type { IViewFileStat } from "@/types";

type Props = {
    file: IViewFileStat;
    lineWrapping: boolean;
};

export default function EditableFilePreview({ file, lineWrapping }: Props) {
    const { t } = useTranslation();
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();

    useEffect(() => {
        let disposed = false;
        setLoading(true);
        setError(undefined);
        loadFileContent(file.uri)
            .then((value) => {
                if (!disposed) setContent(value);
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
            message.success(t("file_editor_save_success"));
        } catch {
            setError(t("file_editor_save_failed"));
        } finally {
            setSaving(false);
        }
    }

    return (
        <>
            <PreviewState loading={loading} error={error}>
                <MonacoTextEditor
                    fileName={file.name}
                    content={content}
                    lineWrapping={lineWrapping}
                    onChange={setContent}
                />
            </PreviewState>
            <footer className="filesviewFileEditorFooter">
                <span />
                <div className="filesviewFileEditorActions">
                    <Button
                        type="primary"
                        loading={saving}
                        disabled={loading || Boolean(error)}
                        onClick={() => void save()}
                        aria-label={t("app_btn_save")}
                        title={t("app_btn_save")}
                    >
                        {t("app_btn_save")}
                    </Button>
                </div>
            </footer>
        </>
    );
}
