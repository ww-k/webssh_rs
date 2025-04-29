import readFileAsText from "@/helpers/read_file_as_text";
import InputFile from "../InputFile";
import type { IInputFileProps } from "../InputFile";

export type IInputTextFromFileProps = {
    maxFileSize?: number;
    onChange?: (files: string) => void;
    onReadFileFail?: (err: Error) => void;
} & Omit<IInputFileProps, "onChange">;

/**
 * un-controlled input
 */
export default function InputTextFromFile({ maxFileSize, onChange, onReadFileFail, ...restProps }: IInputTextFromFileProps) {
    return (
        <InputFile
            onChange={(files) => {
                if (files[0]) {
                    readFileAsText(files[0], maxFileSize)
                        .then(onChange)
                        .catch(onReadFileFail);
                } else {
                    onChange?.("");
                }
            }}
            {...restProps}
        />
    );
}
