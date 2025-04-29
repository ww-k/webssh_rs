import { useState } from "react";
import { CloseCircleFilled, CloseOutlined, FolderOutlined } from "@ant-design/icons";

import "./index.css";

// @ts-ignore
import openNativeFileSelector from "@/helpers/open_native_file_selector";

export interface IInputFileProps {
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
    allowClear = false,
    multiple = false,
    directory = false,
    placeholder,
    onChange,
}: IInputFileProps) {
    const [files, setFiles] = useState<File[]>([]);
    const handleOpenFileSelector = async () => {
        const option = {
            multiple,
            directory,
        };
        let files1: File[] = await openNativeFileSelector(option);
        inputFiles(files1);
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

    function onDropHandle(evt: React.DragEvent) {
        evt.stopPropagation();
        evt.preventDefault();
        inputFiles(Array.from(evt.dataTransfer.files), multiple);
    }

    function onFileRemoveHandle(file: File) {
        const _files = files.filter((_file) => _file !== file);
        inputFiles(_files);
    }

    return (
        <div
            className="ant-select ant-select-outlined ant-select-in-form-item css-var-r1 ant-select-css-var ant-select-multiple ant-select-show-arrow ant-select-show-search"
            onDrop={onDropHandle}
            onClick={handleOpenFileSelector}
        >
            <div className="ant-select-selector">
                <span className="ant-select-selection-wrap">
                    <div className="ant-select-selection-overflow">
                        {files.map((file) => (
                            <div
                                key={`${file.webkitRelativePath}${file.name}`}
                                className="ant-select-selection-overflow-item"
                            >
                                <span className="ant-select-selection-item">
                                    <span className="ant-select-selection-item-content">{file.name}</span>
                                    <span className="ant-select-selection-item-remove">
                                        <CloseOutlined
                                            onClick={(evt) => {
                                                evt.stopPropagation();
                                                onFileRemoveHandle(file);
                                            }}
                                        />
                                    </span>
                                </span>
                            </div>
                        ))}
                        <div className="ant-select-selection-overflow-item ant-select-selection-overflow-item-suffix">
                            <div className="ant-select-selection-search" style={{ width: 4 }}>
                                <input
                                    type="search"
                                    autoComplete="off"
                                    className="ant-select-selection-search-input"
                                    role="combobox"
                                    value=""
                                />
                                <span className="ant-select-selection-search-mirror">&nbsp;</span>
                            </div>
                        </div>
                    </div>
                    {files.length === 0 && (
                        <span className="ant-select-selection-placeholder">
                            {placeholder || "Click to select or drag a file in"}
                        </span>
                    )}
                </span>
            </div>
            <div className="ant-select-arrow">
                <FolderOutlined />
            </div>
            {allowClear && files.length > 0 && (
                <div
                    className="ant-select-clear"
                    onClick={(evt) => {
                        evt.stopPropagation();
                        inputFiles([]);
                    }}
                >
                    <CloseCircleFilled />
                </div>
            )}
        </div>
    );
}
