import { useRef, useState } from "react";

interface IMouseMoveInfo {
    moveX: number;
    moveY: number;
}

/**
 * 异步动作包装, 自动添加loading状态
 */
export default function useResizeLine(
    initPosition: number,
    getContainer: () => HTMLElement,
    direction: "h" | "v" = "h",
): [number, (mouseMoveInfo: IMouseMoveInfo) => void, () => void] {
    const [position, setPosition] = useState(initPosition);
    const seperatorPositionRef = useRef<{
        _seperatorPosition?: number;
        _containerWidth?: number;
    }>({
        _seperatorPosition: undefined,
        _containerWidth: undefined,
    });

    function resizeHandle(e: IMouseMoveInfo) {
        const info = seperatorPositionRef.current;
        const container = getContainer();
        if (info._seperatorPosition === undefined && container) {
            info._seperatorPosition = position;
            info._containerWidth = container.getBoundingClientRect().width;
        }

        if (Number.isNaN(info._seperatorPosition)) {
            return console.error("useResizeLine: position format error");
        }

        const move = direction === "h" ? e.moveY : e.moveX;
        setPosition(
            Math.max(
                0,
                Math.min(
                    100,
                    (info._seperatorPosition || 0) +
                        (move * 100) / (info._containerWidth || 0),
                ),
            ),
        );
    }

    function resizeDoneHandle() {
        seperatorPositionRef.current._seperatorPosition = undefined;
    }

    return [position, resizeHandle, resizeDoneHandle];
}
