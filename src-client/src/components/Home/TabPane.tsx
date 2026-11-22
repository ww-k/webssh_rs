import { memo, useRef } from "react";

import useAppStore, { type ITab } from "@/store";

import ResizeLine from "../ResizeLine";
import useResizeLine from "../ResizeLine/useResizeLine";
import ChildPane from "./ChildPane";

interface TabPaneProps {
    active: boolean;
    tab: ITab;
    className?: string;
}

const SplitNode = memo(function SplitNode({
    className,
    style,
    node,
    activeChildKey,
    ariaHidden,
}: {
    className?: string;
    style?: React.CSSProperties;
    node: ITab;
    activeChildKey: string;
    ariaHidden?: boolean;
}) {
    const setActiveChildKey = useAppStore((state) => state.setActiveChildKey);
    const setSplitRatio = useAppStore((state) => state.setSplitRatio);
    const containerRef = useRef<HTMLDivElement>(null);
    const horizontal = node.direction === "horizontal";
    const ratio = Math.max(15, Math.min(85, node.ratio ?? 50));
    const [position, onResizeMove, onResizeDone] = useResizeLine(
        ratio,
        () => containerRef.current as HTMLElement,
        horizontal ? "v" : "h",
    );

    if (!node.child1 && !node.child2) {
        return (
            <ChildPane
                active={node.key === activeChildKey}
                tab={node}
                className={className}
                style={style}
                onMouseDown={() => setActiveChildKey(node.key)}
            />
        );
    }

    return (
        <div
            ref={containerRef}
            className={`WebSSH-Home-Split WebSSH-Home-Split-${horizontal ? "horizontal" : "vertical"}${className ? ` ${className}` : ""}`}
            style={style}
            aria-hidden={ariaHidden}
        >
            <SplitNode
                node={node.child1 as ITab}
                activeChildKey={activeChildKey}
                className="WebSSH-Home-SplitPart"
                style={{ flex: `${position / 100} 1 0` }}
            />
            <ResizeLine
                direction={horizontal ? "v" : "h"}
                className="WebSSH-Home-SplitResize"
                onMove={onResizeMove}
                onMoved={() => {
                    onResizeDone();
                    setSplitRatio(node.key, position / 100);
                }}
            />
            <SplitNode
                node={node.child2 as ITab}
                activeChildKey={activeChildKey}
                className="WebSSH-Home-SplitPart"
                style={{ flex: `${1 - position / 100} 1 0` }}
            />
        </div>
    );
});

const TabPane = memo(function TabPane({
    active,
    tab,
    className,
}: TabPaneProps) {
    if (!tab.child1 && !tab.child2) {
        return <ChildPane active={active} tab={tab} className={className} />;
    }

    const activeChildKey = tab.activeChildKey ?? tab.key;
    return (
        <SplitNode
            className={className}
            aria-hidden={!active}
            node={tab}
            activeChildKey={activeChildKey}
        />
    );
});

export default TabPane;
