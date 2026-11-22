import { Button as UiButton } from "@ui-sdk/react/button";

import type { ComponentProps, ReactNode } from "react";

import "./index.css";

type UiButtonProps = ComponentProps<typeof UiButton>;

type ButtonVariant = "default" | "dashed" | "link" | "primary" | "text";
type ButtonSize = "large" | "middle" | "small";

export type ButtonProps = Omit<
    UiButtonProps,
    "children" | "disabled" | "type"
> & {
    block?: boolean;
    children?: ReactNode;
    danger?: boolean;
    disabled?: boolean;
    ghost?: boolean;
    htmlType?: "button" | "reset" | "submit";
    icon?: ReactNode;
    loading?: boolean;
    size?: ButtonSize;
    type?: ButtonVariant | "button" | "reset" | "submit";
};

export default function Button({
    block = false,
    children,
    className,
    danger = false,
    disabled = false,
    ghost = false,
    htmlType,
    icon,
    loading = false,
    size,
    type = "default",
    ...props
}: ButtonProps) {
    const nativeType =
        htmlType ??
        (type === "button" || type === "reset" || type === "submit"
            ? type
            : "button");
    const variant =
        type === "button" || type === "reset" || type === "submit"
            ? "default"
            : type;
    const iconOnly = icon != null && children == null;
    const effectiveSize = size ?? (iconOnly ? "large" : "middle");
    const classes = [
        "webssh-button",
        `webssh-button-${variant}`,
        `webssh-button-${effectiveSize}`,
        iconOnly && "webssh-button-icon-only",
        danger && "webssh-button-danger",
        ghost && "webssh-button-ghost",
        block && "webssh-button-block",
        loading && "webssh-button-loading",
        typeof className === "string" && className,
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <UiButton
            {...props}
            type={nativeType}
            className={classes}
            data-danger={danger || undefined}
            data-loading={loading || undefined}
            data-variant={variant}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
        >
            {icon}
            {children}
        </UiButton>
    );
}
