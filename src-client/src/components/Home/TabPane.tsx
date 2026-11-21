import { memo, useRef } from "react";

import useAppStore, { type ITab } from "@/store";

import ResizeLine from "../ResizeLine";
import useResizeLine from "../ResizeLine/useResizeLine";
import ChildPane from "./ChildPane";

interface TabPaneProps {
    active: boolean;
    tab: ITab;
}

const SplitNode = memo(function SplitNode({
    node,
    activeChildKey,
}: {
    node: ITab;
    activeChildKey: string;
}) {
    const setActiveChildKey = useAppStore((state) => state.setActiveChildKey);
    const setSplitRatio = useAppStore((state) => state.setSplitRatio);
    const containerRef = useRef<HTMLDivElement>(null);
    const children = [node.child1, node.child2].filter((child): child is ITab =>
        Boolean(child),
    );
    const horizontal = node.direction === "horizontal";
    const ratio = Math.max(15, Math.min(85, node.ratio ?? 50));
    const [position, onResizeMove, onResizeDone] = useResizeLine(
        ratio,
        () => containerRef.current as HTMLElement,
        horizontal ? "v" : "h",
    );
    return (
        <div
            ref={containerRef}
            className={`WebSSH-Home-Split WebSSH-Home-Split-${horizontal ? "horizontal" : "vertical"}`}
        >
            {children.map((child, index) => (
                <div
                    key={child.key}
                    className="WebSSH-Home-SplitPart"
                    style={{
                        flex:
                            children.length === 2
                                ? `${index === 0 ? position / 100 : 1 - position / 100} 1 0`
                                : "1 1 0",
                    }}
                >
                    {child.child1 || child.child2 ? (
                        <SplitNode
                            node={child}
                            activeChildKey={activeChildKey}
                        />
                    ) : (
                        <div
                            className="WebSSH-Home-SplitLeaf"
                            onMouseDown={() => setActiveChildKey(child.key)}
                        >
                            <ChildPane
                                active={child.key === activeChildKey}
                                tab={child}
                            />
                        </div>
                    )}
                    {index < children.length - 1 && children.length === 2 && (
                        <ResizeLine
                            direction={horizontal ? "v" : "h"}
                            className="WebSSH-Home-SplitResize"
                            onMove={onResizeMove}
                            onMoved={() => {
                                onResizeDone();
                                setSplitRatio(node.key, position / 100);
                            }}
                        />
                    )}
                </div>
            ))}
        </div>
    );
});

const TabPane = memo(function TabPane({ active, tab }: TabPaneProps) {
    if (!tab.child1 && !tab.child2) {
        return <ChildPane active={active} tab={tab} />;
    }

    const activeChildKey = tab.activeChildKey ?? tab.key;
    return (
        <div
            className={`WebSSH-Home-Pane${active ? " is-active" : ""}`}
            aria-hidden={!active}
        >
            <SplitNode node={tab} activeChildKey={activeChildKey} />
        </div>
    );
});

export default TabPane;
