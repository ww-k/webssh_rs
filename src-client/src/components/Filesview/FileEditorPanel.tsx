import {
    CloseOutlined,
    ColumnWidthOutlined,
    EnterOutlined,
    FileSyncOutlined,
} from "@ant-design/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@/components/Button";
import useAppStore from "@/store";

import {
    EditableFilePreview,
    PaginatedFilePreview,
    TailFilePreview,
} from "../FilePreview";
import "../FilePreview/FilePreview.css";

import type { IViewFileStat } from "@/types";

type Props = {
    file: IViewFileStat;
    onClose: () => void;
};

const LARGE_FILE_BYTES = 5 * 1024 * 1024;

export default function FileEditorPanel({ file, onClose }: Props) {
    const { t } = useTranslation();
    const terminalScrollbarThumb = useAppStore(
        (state) => state.terminalThemes[state.theme].scrollbarThumb,
    );
    const [lineWrapping, setLineWrapping] = useState(true);
    const [expanded, setExpanded] = useState(false);
    const [tailMode, setTailMode] = useState(false);
    const paginated = (file.size ?? 0) > LARGE_FILE_BYTES;

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
                        type={tailMode ? "default" : "text"}
                        icon={<FileSyncOutlined />}
                        size="middle"
                        aria-label={t("file_editor_tail_mode")}
                        aria-pressed={tailMode}
                        title={t("file_editor_tail_mode")}
                        onClick={() => setTailMode((value) => !value)}
                    />
                    <Button
                        type={lineWrapping ? "default" : "text"}
                        icon={<EnterOutlined />}
                        size="middle"
                        aria-label={t("file_editor_line_wrap")}
                        aria-pressed={lineWrapping}
                        title={t("file_editor_line_wrap")}
                        onClick={() => setLineWrapping((value) => !value)}
                    />
                    <Button
                        type={expanded ? "default" : "text"}
                        icon={<ColumnWidthOutlined />}
                        size="middle"
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
                        size="middle"
                        aria-label={t("app_btn_cancel")}
                        title={t("app_btn_cancel")}
                        onClick={onClose}
                    />
                </div>
            </header>
            {tailMode ? (
                <TailFilePreview file={file} lineWrapping={lineWrapping} />
            ) : paginated ? (
                <PaginatedFilePreview file={file} lineWrapping={lineWrapping} />
            ) : (
                <EditableFilePreview file={file} lineWrapping={lineWrapping} />
            )}
        </section>
    );
}
