import classNames from "classnames";
import { Component } from "react";

import "./index.less";

interface IResizeLineProps {
    className?: string;
    style?: React.CSSProperties;
    direction: "h" | "v";
    onMove?: (evt: { moveX: number; moveY: number }) => void;
    onMoved?: () => void;
}

export default class ResizeLine extends Component<IResizeLineProps> {
    initInfo: {
        x: number;
        y: number;
    } | null;

    static defaultProps: { className: string; direction: string };
    mouseMoveListener: (e: MouseEvent) => void;
    mouseUpListener: () => void;

    constructor(props: IResizeLineProps) {
        super(props);

        this.initInfo = null;
        this.mouseMoveListener = this._onMove.bind(this);
        this.mouseUpListener = this._onUp.bind(this);
    }

    componentDidMount() {
        window.addEventListener("mousemove", this._onMove.bind(this));
        window.addEventListener("mouseup", this._onUp.bind(this));
    }

    componentWillUnmount() {
        window.removeEventListener("mousemove", this.mouseMoveListener);
        window.removeEventListener("mouseup", this.mouseUpListener);
    }

    render() {
        const { direction, className, style } = this.props;
        const rootCls = classNames({
            resizeLineRootCls: true,
            horizontal: direction === "h",
            vertical: direction === "v",
            [className || ""]: !!className,
        });
        return (
            <div
                className={rootCls}
                style={style}
                onMouseDown={this._dragMouseDownHandle.bind(this)}
            />
        );
    }

    _dragMouseDownHandle(e: React.MouseEvent) {
        this.initInfo = {
            x: e.clientX,
            y: e.clientY,
        };
    }

    _onUp() {
        if (this.initInfo != null) {
            this.initInfo = null;

            this.props.onMoved?.();
        }
    }

    _onMove(e: MouseEvent) {
        if (this.initInfo == null) {
            return;
        }

        const { clientX, clientY } = e;
        const moveX = clientX - this.initInfo.x;
        const moveY = clientY - this.initInfo.y;

        this.props.onMove?.({
            moveX,
            moveY,
        });
    }
}

ResizeLine.defaultProps = {
    className: "",
    direction: "h",
};
