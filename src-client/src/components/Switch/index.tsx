import { SwitchThumb, Switch as UiSwitch } from "@ui-sdk/react/switch";

import type { ComponentProps } from "react";

import "./index.css";

export type SwitchProps = Omit<ComponentProps<typeof UiSwitch>, "children"> & {
    loading?: boolean;
};

export default function Switch({
    className,
    disabled = false,
    loading = false,
    ...props
}: SwitchProps) {
    const rootClassName = [
        "WebSSH-Switch",
        loading && "WebSSH-Switch--loading",
        className,
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <UiSwitch
            {...props}
            aria-busy={loading || undefined}
            className={rootClassName}
            data-loading={loading || undefined}
            disabled={disabled || loading}
        >
            <SwitchThumb />
        </UiSwitch>
    );
}
