import {
    Dialog,
    DialogBackdrop,
    DialogClose,
    DialogContent,
    DialogTitle,
} from "@ui-sdk/react/dialog";
import { X } from "lucide-react";

import type { DialogInitialFocus } from "@ui-sdk/react/dialog";
import type { CSSProperties, ReactNode } from "react";

import "./index.css";

export type AppDialogProps = {
    open: boolean;
    title: ReactNode;
    children?: ReactNode;
    footer?: ReactNode;
    width?: number | string;
    className?: string;
    initialFocus?: DialogInitialFocus;
    dismissible?: boolean;
    showClose?: boolean;
    onCancel?: () => void;
};

export function AppDialog({
    open,
    title,
    children,
    footer,
    width,
    className,
    initialFocus,
    dismissible = true,
    showClose = true,
    onCancel,
}: AppDialogProps) {
    const container =
        typeof document === "undefined"
            ? undefined
            : (document.getElementById("root") ?? undefined);
    const contentClassName = ["webssh-dialog-content", className]
        .filter(Boolean)
        .join(" ");
    const style: CSSProperties | undefined = width
        ? {
              width: `min(${typeof width === "number" ? `${width}px` : width}, calc(100vw - 32px))`,
              maxWidth: "none",
          }
        : undefined;

    return (
        <Dialog
            open={open}
            container={container}
            dismissible={dismissible}
            closeOnOutsidePress={dismissible}
            onOpenChange={(next) => {
                if (!next) onCancel?.();
            }}
        >
            <DialogBackdrop className="webssh-dialog-backdrop" />
            <DialogContent
                className={contentClassName}
                container={container}
                initialFocus={initialFocus}
                style={style}
            >
                <div className="webssh-dialog-header">
                    <DialogTitle>{title}</DialogTitle>
                    {showClose ? (
                        <DialogClose
                            aria-label="Close"
                            className="webssh-dialog-close"
                        >
                            <X aria-hidden="true" size={18} />
                        </DialogClose>
                    ) : null}
                </div>
                <div className="webssh-dialog-body">{children}</div>
                {footer ? (
                    <div className="webssh-dialog-footer">{footer}</div>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

export function DialogAction({
    children,
    danger = false,
    primary = false,
    disabled = false,
    onClick,
}: {
    children: ReactNode;
    danger?: boolean;
    primary?: boolean;
    disabled?: boolean;
    onClick?: () => void;
}) {
    return (
        <DialogClose
            className="webssh-dialog-action"
            data-danger={danger || undefined}
            data-variant={primary ? "solid" : undefined}
            disabled={disabled}
            onClick={onClick}
        >
            {children}
        </DialogClose>
    );
}

export { DialogClose };
