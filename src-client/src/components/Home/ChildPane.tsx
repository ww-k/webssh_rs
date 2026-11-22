import { memo } from "react";

import Filesview from "../Filesview";
import TargetList from "../Target/List";
import Terminal from "../Terminal";

import type { ITab } from "@/store";

interface ChildPaneProps {
    active: boolean;
    tab: ITab;
    className?: string;
    style?: React.CSSProperties;
    onMouseDown?: React.MouseEventHandler<HTMLDivElement>;
}

const ChildPane = memo(function ChildPane({
    active,
    tab,
    className,
    style,
    onMouseDown,
}: ChildPaneProps) {
    const path = tab.path ?? "/";
    let children: JSX.Element;
    switch (true) {
        case path.startsWith("/terminal/"):
            children = <Terminal active={active} tab={tab} />;
            break;
        case path.startsWith("/filesview/"):
            children = <Filesview tab={tab} />;
            break;
        default:
            children = <TargetList tab={tab} />;
            break;
    }

    return (
        <div
            className={`WebSSH-Home-ChildPane${active ? " is-active" : ""}${className ? ` ${className}` : ""}`}
            style={style}
            aria-hidden={!active}
            onMouseDown={onMouseDown}
        >
            {children}
        </div>
    );
});

export default ChildPane;
