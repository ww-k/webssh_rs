import {
    TooltipArrow,
    TooltipContent,
    TooltipTrigger,
    Tooltip as UiTooltip,
} from "@ui-sdk/react/tooltip";

import type { ComponentProps, ReactElement, ReactNode } from "react";

import "./index.css";

type TooltipPlacement =
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

type TooltipProps = Omit<
    ComponentProps<typeof TooltipTrigger>,
    "children" | "render"
> & {
    children: ReactElement;
    placement?: TooltipPlacement;
    title: ReactNode;
};

function getPlacement(placement: TooltipPlacement) {
    const [, side, alignment] =
        placement.match(/^(top|bottom|left|right)(.*)$/i) ?? [];
    const align = alignment
        ? alignment.toLowerCase() === "left" ||
          alignment.toLowerCase() === "top"
            ? "start"
            : "end"
        : "center";

    return {
        align: align as "start" | "center" | "end",
        side: (side?.toLowerCase() ?? "top") as
            | "top"
            | "right"
            | "bottom"
            | "left",
    };
}

export default function Tooltip({
    children,
    placement = "top",
    title,
    ...triggerProps
}: TooltipProps) {
    const { align, side } = getPlacement(placement);
    const isDisabled = Boolean(
        (children.props as { disabled?: boolean }).disabled,
    );
    const trigger = isDisabled ? (
        <span className="webssh-tooltip-trigger">{children}</span>
    ) : (
        children
    );

    return (
        <UiTooltip>
            <TooltipTrigger {...triggerProps} render={trigger} />
            <TooltipContent align={align} side={side}>
                <TooltipArrow />
                {title}
            </TooltipContent>
        </UiTooltip>
    );
}
