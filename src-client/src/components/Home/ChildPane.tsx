import { memo } from "react";

import Filesview from "../Filesview";
import TargetList from "../Target/List";
import Terminal from "../Terminal";

import type { ITab } from "@/store";

interface ChildPaneProps {
    active: boolean;
    tab: ITab;
}

const ChildPane = memo(function ChildPane({ active, tab }: ChildPaneProps) {
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
            className={`WebSSH-Home-ChildPane${active ? " is-active" : ""}`}
            aria-hidden={!active}
        >
            {children}
        </div>
    );
});

export default ChildPane;
