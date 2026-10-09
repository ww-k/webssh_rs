import {
    CloseCircleFilled,
    CloseOutlined,
    FolderOutlined,
} from "@ant-design/icons";
import { useEffect, useState } from "react";

import openNativeFileSelector from "@/helpers/openNativeFileSelector";

import type { DragEvent, KeyboardEvent } from "react";

import "./index.css";

export interface IInputFileProps {
    value?: File[];
    allowClear?: boolean;
    /** 是否允许多选 */
    multiple?: boolean;
    /** 是否选择目录 */
    directory?: boolean;
    placeholder?: string;
    onChange?: (files: File[]) => void;
    getPopupContainer?: () => HTMLElement;
}

export default function InputFile({
    value,
    allowClear = false,
    multiple = false,
    directory = false,
    placeholder,
    onChange,
}: IInputFileProps) {
    const [files, setFiles] = useState<File[]>(value || []);
    const [isDragging, setIsDragging] = useState(false);
    const handleOpenFileSelector = async () => {
        const option = {
            multiple,
            directory,
        };
        try {
            const files1: File[] = await openNativeFileSelector(option);
            inputFiles(files1);
        } catch {
            // The native picker rejects when the user closes it without selecting a file.
        }
    };

    function validate(files1?: File[]) {
        if (!Array.isArray(files1)) return false;
        if (!multiple && files1.length > 1) {
            return false;
        }
        return files1.every((file) => file instanceof File);
    }

    function inputFiles(files1: File[], append?: boolean) {
        if (validate(files1) === false) {
            return;
        }

        let files2: File[];
        if (append) {
            files2 = Array.from(new Set([...files, ...files1]));
        } else {
            files2 = files1;
        }

        onChange?.(files2);
        setFiles(files2);
    }

    function onDropHandle(evt: DragEvent<HTMLDivElement>) {
        evt.stopPropagation();
        evt.preventDefault();
        setIsDragging(false);
        inputFiles(Array.from(evt.dataTransfer.files), multiple);
    }

    function onDragOverHandle(evt: DragEvent<HTMLDivElement>) {
        evt.stopPropagation();
        evt.preventDefault();
        setIsDragging(true);
    }

    function onDragLeaveHandle(evt: DragEvent<HTMLDivElement>) {
        if (evt.currentTarget === evt.target) {
            setIsDragging(false);
        }
    }

    function onKeyDownHandle(evt: KeyboardEvent<HTMLDivElement>) {
        if (evt.key === "Enter" || evt.key === " ") {
            evt.preventDefault();
            void handleOpenFileSelector();
        }
    }

    function onFileRemoveHandle(file: File) {
        const _files = files.filter((_file) => _file !== file);
        inputFiles(_files);
    }

    // biome-ignore lint/correctness/useExhaustiveDependencies: 只需要在value变化时调用
    useEffect(() => {
        if (Array.isArray(value) && value !== files) {
            inputFiles(value);
        }
    }, [value]);

    return (
        <div
            className={`inputFile${files.length > 0 ? " inputFile--has-value" : ""}${
                isDragging ? " inputFile--dragging" : ""
            }`}
            role="group"
            tabIndex={0}
            aria-label={placeholder || "Choose a file"}
            onDrop={onDropHandle}
            onDragOver={onDragOverHandle}
            onDragLeave={onDragLeaveHandle}
            onClick={handleOpenFileSelector}
            onKeyDown={onKeyDownHandle}
        >
            <div className="inputFile__content">
                {files.length > 0 ? (
                    files.map((file) => (
                        <span
                            key={`${file.webkitRelativePath}${file.name}`}
                            className="inputFile__file"
                            title={file.name}
                        >
                            <span className="inputFile__file-name">
                                {file.name}
                            </span>
                            <button
                                type="button"
                                className="inputFile__remove"
                                aria-label={`Remove ${file.name}`}
                                onClick={(evt) => {
                                    evt.stopPropagation();
                                    onFileRemoveHandle(file);
                                }}
                                onKeyDown={(evt) => evt.stopPropagation()}
                            >
                                <CloseOutlined />
                            </button>
                        </span>
                    ))
                ) : (
                    <span className="inputFile__placeholder">
                        {placeholder || "Click to select or drag a file in"}
                    </span>
                )}
            </div>
            <span className="inputFile__icon" aria-hidden="true">
                <FolderOutlined />
            </span>
            {allowClear && files.length > 0 && (
                <button
                    type="button"
                    className="inputFile__clear"
                    aria-label="Clear files"
                    onClick={(evt) => {
                        evt.stopPropagation();
                        inputFiles([]);
                    }}
                >
                    <CloseCircleFilled />
                </button>
            )}
        </div>
    );
}
