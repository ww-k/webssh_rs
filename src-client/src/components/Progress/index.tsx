import {
    ProgressIndicator,
    ProgressTrack,
    Progress as UiProgress,
} from "@ui-sdk/react/progress";

import type { ComponentProps } from "react";

import "./index.css";

type UiProgressProps = ComponentProps<typeof UiProgress>;

export type ProgressProps = Omit<UiProgressProps, "children" | "className"> & {
    className?: string;
    size?: "default" | "small";
    status?: "active" | "exception" | "normal" | "success";
    successPercent?: number;
};

export default function Progress({
    className,
    size = "default",
    status = "active",
    successPercent,
    ...props
}: ProgressProps) {
    const classes = [
        "webssh-progress",
        `webssh-progress-${size}`,
        `webssh-progress-${status}`,
        className,
    ]
        .filter(Boolean)
        .join(" ");
    const successWidth = Math.min(Math.max(successPercent ?? 0, 0), 100);

    return (
        <UiProgress {...props} className={classes}>
            <ProgressTrack>
                <ProgressIndicator />
                {successPercent !== undefined && (
                    <span
                        className="webssh-progress-success-indicator"
                        style={{ width: `${successWidth}%` }}
                        aria-hidden="true"
                    />
                )}
            </ProgressTrack>
        </UiProgress>
    );
}
