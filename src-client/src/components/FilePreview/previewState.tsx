import { Spin } from "antd";
import { useTranslation } from "react-i18next";

import type { ReactNode } from "react";

type Props = {
    loading: boolean;
    error?: string;
    children: ReactNode;
};

export default function PreviewState({ loading, error, children }: Props) {
    const { t } = useTranslation();
    return (
        <div className="filesviewFileEditorBody">
            {loading ? (
                <div className="filesviewFileEditorState">
                    <Spin tip={t("file_editor_loading")} />
                </div>
            ) : error ? (
                <div className="filesviewFileEditorState">{error}</div>
            ) : (
                children
            )}
        </div>
    );
}
