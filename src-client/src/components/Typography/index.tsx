import { CopyOutlined } from "@ant-design/icons";
import clsx from "clsx";
import {
    type CSSProperties,
    type HTMLAttributes,
    type ReactNode,
    useState,
} from "react";

import Button from "@/components/Button";
import Tooltip from "@/components/Tooltip";

import "./index.css";

type Copyable = { text?: string };
type Ellipsis = boolean | { tooltip?: ReactNode };

type TypographyTextProps = Omit<HTMLAttributes<HTMLSpanElement>, "color"> & {
    code?: boolean;
    copyable: Copyable;
    ellipsis?: Ellipsis;
};

const getTextContent = (children: ReactNode) => {
    if (typeof children === "string" || typeof children === "number") {
        return String(children);
    }
    return "";
};

async function copyText(text: string) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
}

function getTextClassName({
    className,
    code,
    ellipsis,
}: Pick<TypographyTextProps, "className" | "code" | "ellipsis">) {
    return clsx(
        "webssh-typography",
        "webssh-typography-text",
        { "webssh-typography-code": code },
        { "webssh-typography-ellipsis": ellipsis },
        className,
    );
}

export function TypographyText({
    children,
    className,
    code = false,
    copyable,
    ellipsis,
    style,
    ...props
}: TypographyTextProps) {
    const [copied, setCopied] = useState(false);
    const text = copyable.text ?? getTextContent(children);
    const title = typeof ellipsis === "object" ? ellipsis.tooltip : undefined;
    const textStyle: CSSProperties = {
        ...style,
        ...(ellipsis ? { minWidth: 0 } : undefined),
    };

    const content = (
        <span
            {...props}
            className={getTextClassName({
                className,
                code,
                ellipsis,
            })}
            style={textStyle}
            title={title === undefined && ellipsis ? text : undefined}
        >
            {children}
        </span>
    );
    const displayedContent =
        title === undefined ? (
            content
        ) : (
            <Tooltip title={title}>{content}</Tooltip>
        );

    const copyButton = (
        <Button
            aria-label={copied ? "Copied" : "Copy"}
            className="webssh-typography-copy"
            icon={<CopyOutlined />}
            onClick={() => {
                void copyText(text).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                });
            }}
            size="small"
            type="text"
        />
    );

    return (
        <span className="webssh-typography-copyable">
            {displayedContent}
            <Tooltip title={copied ? "Copied" : "Copy"}>{copyButton}</Tooltip>
        </span>
    );
}
