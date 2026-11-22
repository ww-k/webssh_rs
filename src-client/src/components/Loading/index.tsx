import {
    Progress,
    ProgressIndicator,
    ProgressTrack,
} from "@ui-sdk/react/progress";

import type { ReactNode } from "react";

import "./index.css";

export type LoadingProps = {
    className?: string;
    spinning?: boolean;
    tip?: ReactNode;
};

export default function Loading({
    className,
    spinning = true,
    tip,
}: LoadingProps) {
    if (!spinning) {
        return null;
    }

    const classes = ["webssh-loading", className].filter(Boolean).join(" ");
    const label = typeof tip === "string" ? tip : "Loading";

    return (
        <Progress
            className={classes}
            value={null}
            aria-label={label}
            aria-live="polite"
        >
            <ProgressTrack>
                <ProgressIndicator />
            </ProgressTrack>
            {tip && <span className="webssh-loading-tip">{tip}</span>}
        </Progress>
    );
}
