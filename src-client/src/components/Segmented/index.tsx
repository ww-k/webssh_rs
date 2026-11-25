import {
    SegmentedControl,
    SegmentedControlIndicator,
    SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";

import type { CSSProperties, ReactNode } from "react";

import "./index.css";

export interface SegmentedOption<T extends string = string> {
    value: T;
    label: ReactNode;
    icon?: ReactNode;
    disabled?: boolean;
}

interface SegmentedProps<T extends string = string> {
    "aria-label"?: string;
    className?: string;
    disabled?: boolean;
    onChange?: (value: T) => void;
    options: SegmentedOption<T>[];
    style?: CSSProperties;
    value?: T | null;
}

export default function Segmented<T extends string = string>({
    "aria-label": ariaLabel,
    className,
    disabled = false,
    onChange,
    options,
    style,
    value,
}: SegmentedProps<T>) {
    const rootClassName = className
        ? `WebSSH-Segmented ${className}`
        : "WebSSH-Segmented";

    return (
        <SegmentedControl<T>
            aria-label={ariaLabel}
            className={rootClassName}
            disabled={disabled}
            style={style}
            value={value ?? null}
            onValueChange={(nextValue) => {
                if (nextValue !== null) onChange?.(nextValue);
            }}
        >
            <SegmentedControlIndicator />
            {options.map((option) => (
                <SegmentedControlItem
                    key={option.value}
                    className="WebSSH-SegmentedItem"
                    disabled={option.disabled}
                    value={option.value}
                >
                    {option.icon}
                    <span>{option.label}</span>
                </SegmentedControlItem>
            ))}
        </SegmentedControl>
    );
}
