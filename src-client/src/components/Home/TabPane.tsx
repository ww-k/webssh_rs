import { memo } from "react";

import Filesview from "../Filesview";
import TargetSelector from "../Target/Selector";
import Terminal from "../Terminal";

import type { ITab } from "@/store";

interface TabPaneProps {
    active: boolean;
    tab: ITab;
}

const TabPane = memo(function TabPane({ active, tab }: TabPaneProps) {
    let children: JSX.Element;
    switch (true) {
        case tab.path.startsWith("/terminal/"):
            children = <Terminal active={active} tab={tab} />;
            break;
        case tab.path.startsWith("/filesview/"):
            children = <Filesview tab={tab} />;
            break;
        default:
            children = <TargetSelector active={active} tab={tab} />;
            break;
    }

    return (
        <div
            className={`WebSSH-Home-Pane${active ? " is-active" : ""}`}
            aria-hidden={!active}
        >
            {children}
        </div>
    );
});

export default TabPane;
