import classNames from "clsx";
import { useCallback, useEffect, useRef } from "react";

import "./index.css";

interface IProps {
    className?: string;
    style?: React.CSSProperties;
    direction?: "h" | "v";
    onMove?: (evt: { moveX: number; moveY: number }) => void;
    onMoved?: () => void;
}

export default function ResizeLine({
    className,
    style,
    direction = "h",
    onMove,
    onMoved,
}: IProps) {
    const rootCls = classNames({
        resizeLineHorizontal: direction === "h",
        resizeLineVertical: direction === "v",
        [className || ""]: className !== "",
    });

    const initInfoRef = useRef<{ x: number; y: number }>();

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        initInfoRef.current = {
            x: e.clientX,
            y: e.clientY,
        };
    }, []);

    // biome-ignore lint/correctness/useExhaustiveDependencies: no need add onMove and onMoved to dependencies
    useEffect(() => {
        function handleMouseMove(e: MouseEvent) {
            if (!initInfoRef.current) {
                return;
            }

            const { clientX, clientY } = e;
            const moveX = clientX - initInfoRef.current.x;
            const moveY = clientY - initInfoRef.current.y;

            onMove?.({
                moveX,
                moveY,
            });
        }
        function handleMouseUp() {
            if (initInfoRef.current) {
                initInfoRef.current = undefined;
                onMoved?.();
            }
        }
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, []);

    return (
        <div className={rootCls} style={style} onMouseDown={handleMouseDown} />
    );
}
