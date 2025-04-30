import { useEffect, useRef, useState } from "react";
import readFileAsText from "@/helpers/read_file_as_text";
import InputFile from "../InputFile";
import type { IInputFileProps } from "../InputFile";

export type IInputTextFromFileProps = {
    value?: string;
    maxFileSize?: number;
    onChange?: (files: string) => void;
    onReadFileFail?: (err: Error) => void;
} & Omit<IInputFileProps, "value" | "onChange">;

const EMPTY_FILES: File[] = [];

export default function InputTextFromFile({
    value,
    maxFileSize,
    onChange,
    onReadFileFail,
    ...restProps
}: IInputTextFromFileProps) {
    const [files, setFiles] = useState<File[]>(EMPTY_FILES);
    const filesStringRef = useRef<[File[], string]>(null);

    useEffect(() => {
        if (!value) {
            setFiles(EMPTY_FILES);
        } else if (value !== filesStringRef.current?.[1]) {
            const ANONYMOUS_FILES = [new File([], "anonymous")];
            filesStringRef.current = [ANONYMOUS_FILES, value];
            setFiles(ANONYMOUS_FILES);
        }
    }, [value]);

    useEffect(() => {
        console.log("InputTextFromFile", files, files === EMPTY_FILES);
    }, [files]);

    return (
        <InputFile
            value={files}
            onChange={(files) => {
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
                    onChange?.("");
                }
            }}
            {...restProps}
        />
    );
}
