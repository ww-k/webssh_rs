import { Modal, Spin } from "antd";
import { useEffect, useRef, useState } from "react";

import readFileAsText from "@/helpers/readFileAsText";

import InputFile from "../InputFile";

import type { IInputFileProps } from "../InputFile";

import "./index.css";

export type IInputTextFromFileProps = {
    value?: string;
    maxFileSize?: number;
    onChange?: (files: string) => void;
    onReadFileFail?: (err: Error) => void;
} & Omit<IInputFileProps, "value" | "onChange" | "onFileClick">;

const EMPTY_FILES: File[] = [];

export default function InputTextFromFile({
    value,
    maxFileSize,
    onChange,
    onReadFileFail,
    ...restProps
}: IInputTextFromFileProps) {
    const [files, setFiles] = useState<File[]>(EMPTY_FILES);
    const [preview, setPreview] = useState<{
        file: File;
        text?: string;
    }>();
    const [previewLoading, setPreviewLoading] = useState(false);
    const filesStringRef = useRef<[File[], string]>();

    useEffect(() => {
        if (!value) {
            filesStringRef.current = undefined;
            setFiles(EMPTY_FILES);
            setPreview(undefined);
            setPreviewLoading(false);
        } else if (value !== filesStringRef.current?.[1]) {
            const ANONYMOUS_FILES = [new File([], "anonymous")];
            filesStringRef.current = [ANONYMOUS_FILES, value];
            setFiles(ANONYMOUS_FILES);
            setPreview(undefined);
            setPreviewLoading(false);
        }
    }, [value]);

    function handleFileClick(file: File) {
        const cached = filesStringRef.current;
        if (cached?.[0]?.[0] === file) {
            setPreview({ file, text: cached[1] });
            setPreviewLoading(false);
            return;
        }

        setPreview({ file });
        setPreviewLoading(true);
        readFileAsText(file, maxFileSize)
            .then((text) => {
                filesStringRef.current = [files, text];
                setPreview({ file, text });
            })
            .catch(() => {
                setPreview(undefined);
            })
            .finally(() => {
                setPreviewLoading(false);
            });
    }

    return (
        <>
            <InputFile
                value={files}
                onFileClick={handleFileClick}
                onChange={(files) => {
                    setPreview(undefined);
                    setPreviewLoading(false);
                    if (files[0]) {
                        if (files === filesStringRef.current?.[0]) {
                            return;
                        }
                        setFiles(files);
                        readFileAsText(files[0], maxFileSize)
                            .then((text) => {
                                filesStringRef.current = [files, text];
                                onChange?.(text);
                            })
                            .catch(onReadFileFail);
                    } else {
                        filesStringRef.current = undefined;
                        onChange?.("");
                    }
                }}
                {...restProps}
            />
            <Modal
                open={Boolean(preview)}
                title={preview?.file.name}
                footer={null}
                width={720}
                onCancel={() => setPreview(undefined)}
            >
                {previewLoading ? (
                    <div className="inputTextFromFile__preview-loading">
                        <Spin />
                    </div>
                ) : (
                    <pre className="inputTextFromFile__preview-content">
                        {preview?.text}
                    </pre>
                )}
            </Modal>
        </>
    );
}
