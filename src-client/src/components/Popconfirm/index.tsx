import { ExclamationCircleFilled } from "@ant-design/icons";
import {
    Popover,
    PopoverArrow,
    PopoverClose,
    PopoverContent,
    PopoverDescription,
    PopoverTitle,
    PopoverTrigger,
} from "@ui-sdk/react/popover";
import {
    type MouseEvent,
    type ReactElement,
    type ReactNode,
    useState,
} from "react";

import Button, { type ButtonProps } from "@/components/Button";

import "./index.css";

type PopconfirmPlacement =
    | "top"
    | "topLeft"
    | "topRight"
    | "bottom"
    | "bottomLeft"
    | "bottomRight"
    | "left"
    | "leftTop"
    | "leftBottom"
    | "right"
    | "rightTop"
    | "rightBottom";

export type PopconfirmProps = {
    title: ReactNode;
    description?: ReactNode;
    children: ReactElement;
    disabled?: boolean;
    icon?: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onConfirm?: (event?: MouseEvent<HTMLElement>) => unknown;
    onCancel?: (event?: MouseEvent<HTMLElement>) => void;
    okText?: ReactNode;
    okButtonProps?: Partial<ButtonProps>;
    cancelText?: ReactNode;
    cancelButtonProps?: Partial<ButtonProps>;
    placement?: PopconfirmPlacement;
};

function getPlacement(placement: PopconfirmPlacement) {
    const [, side, alignment] =
        placement.match(/^(top|bottom|left|right)(.*)$/i) ?? [];
    const edge = alignment?.toLowerCase();
    const align = !edge
        ? "center"
        : edge === "left" || edge === "top"
          ? "start"
          : "end";

    return {
        align: align as "start" | "center" | "end",
        side: (side?.toLowerCase() ?? "top") as
            | "top"
            | "right"
            | "bottom"
            | "left",
    };
}

export default function Popconfirm({
    title,
    description,
    children,
    disabled = false,
    icon,
    open: controlledOpen,
    onOpenChange,
    onConfirm,
    onCancel,
    okText,
    okButtonProps,
    cancelText,
    cancelButtonProps,
    placement = "top",
}: PopconfirmProps) {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
    const isOpen = controlledOpen ?? uncontrolledOpen;
    const { align, side } = getPlacement(placement);

    const changeOpen = (next: boolean) => {
        if (controlledOpen === undefined) {
            setUncontrolledOpen(next);
        }
        onOpenChange?.(next);
    };

    // Same contract as antd: `false` vetoes closing, a promise closes once it
    // resolves and stays open if it rejects, anything else closes at once.
    const handleConfirm = async (event: MouseEvent<HTMLElement>) => {
        let result: unknown;
        try {
            result = await onConfirm?.(event);
        } catch {
            return;
        }
        if (result === false) return;
        changeOpen(false);
    };

    // PopoverClose performs the close itself; this only reports the cancel.
    const handleCancel = (event: MouseEvent<HTMLElement>) => {
        onCancel?.(event);
    };

    return (
        <Popover
            modal="trap-focus"
            open={isOpen}
            onOpenChange={(next, details) => {
                if (disabled) {
                    details.cancel();
                    return;
                }

                if (!next && details.reason === "close-press") {
                    // The Cancel button reports its own onCancel.
                    changeOpen(false);
                    return;
                }
                changeOpen(next);
            }}
        >
            <PopoverTrigger render={children} disabled={disabled} />
            <PopoverContent
                align={align}
                className="webssh-popconfirm"
                side={side}
                sideOffset={8}
            >
                <PopoverArrow className="webssh-popconfirm-arrow" />
                <div className="webssh-popconfirm-body">
                    {icon === null ? null : (
                        <span className="webssh-popconfirm-icon">
                            {icon ?? <ExclamationCircleFilled />}
                        </span>
                    )}
                    <div className="webssh-popconfirm-text">
                        <PopoverTitle>{title}</PopoverTitle>
                        {description ? (
                            <PopoverDescription>
                                {description}
                            </PopoverDescription>
                        ) : null}
                    </div>
                </div>
                <div className="webssh-popconfirm-actions">
                    <PopoverClose
                        render={
                            <Button
                                {...cancelButtonProps}
                                size="small"
                                onClick={handleCancel}
                            >
                                {cancelText}
                            </Button>
                        }
                    />
                    <Button
                        {...okButtonProps}
                        size="small"
                        type="primary"
                        onClick={handleConfirm}
                    >
                        {okText}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
