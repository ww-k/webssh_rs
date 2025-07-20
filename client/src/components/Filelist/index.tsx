import { Spin } from "antd";
import classNames from "classnames";
import orderBy from "lodash/orderBy";
import { Component, createRef } from "react";

import "./index.css";

import { getParentDirUri } from "@/helpers/file_uri";

import getColumns from "./getColumns";
import Tbody from "./tbody";
import Theader from "./theader";

import type { IFile } from "@/types";
import type {
    IFileListColumn,
    IFileListCopyEvent,
    IFileListDragDropEvent,
} from "./types";

const EMPTY_FILE_ARR: IFile[] = [];
const LAYOUT_COL_CHECKBOX_WIDTH = 26;
const LAYOUT_ROW_HEIGHT = 24;

interface IProps {
    className?: string;
    data: IFile[];
    cwd: string;
    loading?: boolean;
    draggable?: boolean;
    emptyContent?: React.ReactNode | (() => React.ReactNode);
    enableCheckbox?: boolean;
    enableParentFile?: boolean;
    sortByDefault?: string;
    sortOrderDefault?: "ascend" | "descend";
    posix?: boolean;
    onSelecteChange?: (files: IFile[]) => void;
    onFileClick?: (file: IFile) => void;
    onFileDoubleClick?: (file: IFile) => void;
    onContextMenu?: (
        files: IFile[] | null,
        evt: MouseEvent | React.MouseEvent,
    ) => void;
    onTheaderContextMenu?: (evt: React.MouseEvent) => void;
    onDrop?: (evt: IFileListDragDropEvent) => void;
    onEnter?: (file: IFile) => void;
    onDelete?: (files: IFile[]) => void;
    onCopy?: (evt: IFileListCopyEvent) => void;
    onPaste?: () => void;
    onCut?: () => void;
    onRename?: (file: IFile) => void;
    onColResize?: () => void;
}

interface IState {
    columns: IFileListColumn[];
    data: IFile[];
    sortBy: string;
    sortByDefault: string;
    sortOrderDefault: "ascend" | "descend";
    sortOrderAscend: boolean;
    layoutContainerWidth: number;
    layoutContainerHeight: number;
    layoutTableWidth: number;
    layoutColCheckboxWidth: number;
    selected: IFile[];
    activeKey: string | null;
    scrollOffset: number;
}

export default class Filelist extends Component<IProps, IState> {
    static defaultProps = {
        className: "",
        data: [],
        draggable: false,
        enableCheckbox: true,
        enableParentFile: false,
        loading: true,
    };
    rootElRef: React.RefObject<HTMLDivElement> = createRef();
    listTbodyRef: React.RefObject<Tbody> = createRef();
    listTheaderRef: React.RefObject<Theader> = createRef();
    parentFile: IFile;
    guessKeybordInput: (keyCode: number) => string;
    _active_path: string | null = null;
    _resizeObserver?: ResizeObserver;
    __support_sticky_position__: boolean | undefined;

    constructor(props: IProps) {
        super(props);

        const parentUri = getParentDirUri(props.cwd);
        this.parentFile = {
            atime: 0,
            isDir: true,
            mtime: 0,
            name: "..",
            size: 0,
            permissions: "",
            sortName: "",
            type: "d",
            uri: parentUri,
        };

        const sortByDefault = props.sortByDefault || "sortName";
        const sortOrderDefault = props.sortOrderDefault || "ascend";
        const defaultOrder = sortOrderDefault === "ascend" ? "asc" : "desc";

        const columns = getColumns();
        this.state = {
            activeKey: null,
            columns,
            data: this._prepareData(
                props.data,
                ["isDir", sortByDefault],
                ["desc", defaultOrder],
                props.cwd,
                props.enableParentFile || false,
            ),
            layoutColCheckboxWidth: props.enableCheckbox
                ? LAYOUT_COL_CHECKBOX_WIDTH
                : 0,
            layoutContainerHeight: 0,
            layoutContainerWidth: 0,
            layoutTableWidth: this.caculatelayoutTableWidth(
                columns,
                props.enableCheckbox,
            ),
            scrollOffset: 0,
            selected: EMPTY_FILE_ARR,
            sortBy: sortByDefault,
            sortByDefault,
            sortOrderAscend: sortOrderDefault === "ascend",
            sortOrderDefault,
        };

        this.guessKeybordInput = guessKeybordInputCreator();
    }

    componentDidUpdate(prevProps: IProps) {
        const nextProps = this.props;

        if (prevProps.cwd !== nextProps.cwd && nextProps.enableParentFile) {
            this.parentFile.uri = getParentDirUri(nextProps.cwd);
            this.listTheaderRef.current?.unselectAll();
        }

        if (prevProps.data !== nextProps.data) {
            let activeItem: IFile | undefined;
            let selected: IFile[] = EMPTY_FILE_ARR;
            const data = this._prepareData(
                nextProps.data,
                ["isDir", this.state.sortBy],
                [
                    this.state.sortOrderAscend ? "desc" : "asc",
                    this.state.sortOrderAscend ? "asc" : "desc",
                ],
                nextProps.cwd,
                nextProps.enableParentFile || false,
            );
            if (this._active_path) {
                activeItem = data.find(
                    (item) => item.uri === this._active_path,
                );
                if (activeItem) {
                    selected = [activeItem];
                }
            }
            this.setState({
                activeKey: activeItem?.uri || null,
                data,
                selected,
            });
            this._active_path = null;
            this.listTheaderRef.current?.unselectAll();
        }

        if (
            this.props.data.length !== prevProps.data.length &&
            this.rootElRef.current
        ) {
            // 原因分析：
            // 当由一个滚动高度超过一个容器高度的列表变为一个列表总高度不足一屏的列表时，
            // 实际的容器scrollTop已经变为0了，由于firefox不会触发onScroll事件，
            // 存储的scrollOffset没有变化，tbody组件中caculateData方法计算出错误的结果，从而导致列表中无数据展示
            // 解决方法：
            // 在数据变化和容器高度变化后，如果当前scrollTop与记录的scrollOffset不一致
            // 调用scrollTo方法，重新设置scrollOffset
            const scrollTop = this.rootElRef.current.scrollTop;
            const { scrollOffset } = this.state;
            if (scrollTop !== scrollOffset) {
                this.scrollTo(scrollTop);
            }
        }
    }

    componentDidMount() {
        const update = (size: DOMRectReadOnly) => {
            const rootEl = this.rootElRef.current;
            const theader = this.listTheaderRef.current?.getRootDom();
            if (!theader) return;
            const theaderRect = theader.getBoundingClientRect();
            // @ts-ignore
            const scrollTop = rootEl.scrollTop;
            const { scrollOffset } = this.state;
            if (scrollTop !== scrollOffset) {
                this.scrollTo(scrollTop);
            }
            this.setState({
                layoutContainerWidth: size.width,
                layoutContainerHeight: size.height - theaderRect.height,
            });
        };
        this._resizeObserver = new ResizeObserver((entries, observer) => {
            const rootEl = this.rootElRef.current;
            if (!rootEl || !this.listTheaderRef.current) {
                observer.disconnect();
                return;
            }
            entries.forEach((entry) => {
                if (entry.target === rootEl) {
                    const size = entry.contentRect;
                    console.debug("Filelist/index: ResizeObserver size", size);
                    update(size);
                }
            });
        });

        const rootEl = this.rootElRef.current;
        this._resizeObserver.observe(rootEl as Element);
        // @ts-ignore
        update(rootEl.getBoundingClientRect());
    }

    componentWillUnmount() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = undefined;
        }
    }

    render() {
        const {
            className,
            cwd,
            loading,
            draggable,
            emptyContent,
            enableCheckbox,
            onColResize,
        } = this.props;
        const {
            columns,
            data,
            activeKey,
            selected,
            layoutColCheckboxWidth,
            layoutTableWidth,
            layoutContainerWidth,
            layoutContainerHeight,
            sortByDefault,
            sortOrderDefault,
            scrollOffset,
        } = this.state;
        const rootCls = classNames({
            filelist: true,
            [className || ""]: className !== "",
            filelistLoading: loading,
        });
        const loadLayerCls = classNames({
            filelistLoadLayer: loading,
            filelistLoadLayerHide: !loading,
        });
        return (
            <div
                className={rootCls}
                onContextMenu={this.contextMenuHandle.bind(this, null)}
                onKeyDown={this.rootKeyDownHandle.bind(this)}
                onMouseDown={this.rootMouseDownHandle.bind(this)}
                onScroll={this.scrollHandle.bind(this)}
                ref={this.rootElRef}
                tabIndex={-1}
            >
                <Theader
                    ref={this.listTheaderRef}
                    columns={columns}
                    enableCheckbox={enableCheckbox}
                    layoutColCheckboxWidth={layoutColCheckboxWidth}
                    layoutTableWidth={layoutTableWidth}
                    sortByDefault={sortByDefault}
                    sortOrderDefault={sortOrderDefault}
                    onCheckChange={this.handleCheckAllChange.bind(this)}
                    onContextMenu={this.handleHeaderContextMenu.bind(this)}
                    onColResize={this.handleColResize.bind(this)}
                    onColResizeDone={onColResize}
                    onSort={this.handleSort.bind(this)}
                />
                {emptyContent ? (
                    typeof emptyContent === "function" ? (
                        emptyContent()
                    ) : (
                        <div className="filelistEmptyContent">
                            {emptyContent}
                        </div>
                    )
                ) : (
                    <Tbody
                        ref={this.listTbodyRef}
                        columns={columns}
                        data={data}
                        cwd={cwd}
                        activeKey={activeKey}
                        draggable={draggable}
                        enableCheckbox={enableCheckbox}
                        parentFile={this.parentFile}
                        scrollOffset={scrollOffset}
                        selected={selected}
                        layoutRowHeight={LAYOUT_ROW_HEIGHT}
                        layoutColCheckboxWidth={layoutColCheckboxWidth}
                        layoutContainerHeight={layoutContainerHeight}
                        layoutContainerWidth={layoutContainerWidth}
                        layoutTableWidth={layoutTableWidth}
                        onActive={this.ensureActiveItemVisible.bind(this)}
                        onContextMenu={this.contextMenuHandle.bind(this)}
                        onDrop={this.filesDropHandle.bind(this)}
                        onFileClick={this.fileClickHandle.bind(this)}
                        onFileDoubleClick={this.fileDoubleClickHandle.bind(
                            this,
                        )}
                        onSelected={this.filesSelectedChange.bind(this)}
                    />
                )}
                <div className={loadLayerCls}>
                    <Spin spinning={loading} />
                </div>
            </div>
        );
    }

    scrollHandle(evt: React.UIEvent) {
        const { clientHeight, scrollTop, scrollHeight } = evt.currentTarget;

        this.scrollTheaderTo(scrollTop);

        this.setState((prevState) => {
            if (prevState.scrollOffset === scrollTop) {
                return null;
            }
            let scrollOffset = scrollTop;

            // Prevent Safari's elastic scrolling from causing visual shaking when scrolling past bounds.
            scrollOffset = Math.max(
                0,
                Math.min(scrollOffset, scrollHeight - clientHeight),
            );

            return {
                scrollOffset,
            };
        });
    }

    /**
     * 处理data，增加一些组件需要的数据
     */
    _prepareData(
        data: IFile[],
        iteratees: string[],
        orders: ("asc" | "desc")[],
        cwd: string,
        enableParentFile: boolean,
    ) {
        const newData = orderBy(data, iteratees, orders);
        if (this.parentFile.uri !== cwd && enableParentFile) {
            newData.unshift(this.parentFile);
        }
        return newData;
    }

    /**
     * 组件根节点键盘事件处理函数
     */
    rootKeyDownHandle(e: React.KeyboardEvent) {
        const keyCode = e.keyCode;
        const key = e.key;
        console.log("rootKeyDownHandle", key, keyCode);
        switch (true) {
            case key === "Backspace":
                e.preventDefault();
                return this.onEnterHandle(this.parentFile);
            case key === "Enter":
                return this.onEnterHandle();
            case key === "Delete":
                return this.onDeleteHandle();
            case e.ctrlKey && (key === "a" || key === "A"): // ctrl + a
            case e.metaKey && (key === "a" || key === "A"): // mac command + a
                e.preventDefault();
                return this.listTbodyRef.current?.selectAll();
            case e.ctrlKey && (key === "x" || key === "X"): // ctrl + x 剪切
            case e.metaKey && (key === "x" || key === "X"): // mac command + x 剪切
                return this.handleCut();
            case e.ctrlKey && (key === "c" || key === "C"): // ctrl + c 复制
            case e.metaKey && (key === "c" || key === "C"): // mac command + c 复制
                return this.handleCopy();
            case e.ctrlKey && (key === "v" || key === "V"): // ctrl + v 粘贴
            case e.metaKey && (key === "v" || key === "V"): // mac command + v 粘贴
                return this.handlePaste();
            case !e.shiftKey && key === "ArrowUp":
                e.preventDefault();
                return this.listTbodyRef.current?.selectNext(true);
            case !e.shiftKey && key === "ArrowDown":
                e.preventDefault();
                return this.listTbodyRef.current?.selectNext(false);
            case e.shiftKey && key === "ArrowUp":
                e.preventDefault();
                return this.listTbodyRef.current?.shiftSelectNext(true);
            case e.shiftKey && key === "ArrowDown":
                e.preventDefault();
                return this.listTbodyRef.current?.shiftSelectNext(false);
            case key === "F2":
                return this.handleRename?.();
            case (keyCode >= 48 && keyCode <= 57) ||
                (keyCode >= 65 && keyCode <= 90): //0-9 && a-z
                return this.listTbodyRef.current?.selectByKeyword(
                    this.guessKeybordInput(keyCode),
                );
            default:
                return;
        }
    }

    /** 重命名 */
    handleRename() {
        const { onRename } = this.props;
        const { selected } = this.state;
        if (!selected) return;
        if (selected.length === 1 && selected[0].name === "..") {
            return;
        }

        // 仿照windows，多选时默认修改最后一个文件名
        const last = selected[selected.length - 1];
        onRename?.(last);
    }

    /**
     * 剪切ctrl+x
     */
    handleCut() {
        const { selected } = this.state;
        if (selected.length === 1 && selected[0].name === "..") {
            return;
        }

        this.handleCopy(true);
    }

    /**
     * 选中ctrl+c
     */
    handleCopy(isCut?: boolean) {
        const { selected } = this.state;
        const { onCopy, cwd: fileUri } = this.props;
        if (selected.length === 1 && selected[0].name === "..") {
            return;
        }

        if (selected.length > 0) {
            const copyData: IFileListCopyEvent = {
                files: selected,
                fileUri,
                type: isCut ? "cut" : "copy",
            };
            onCopy?.(copyData);
        }
    }

    /**
     * 选中ctrl+v
     */
    handlePaste() {
        this.props.onPaste?.();
    }

    /**
     * 组件根节点鼠标按下事件处理函数。focus组件，之后就能捕捉键盘事件了
     */
    rootMouseDownHandle() {
        this.rootElRef.current?.focus({ preventScroll: true });
    }

    /**
     * 使filelist组件聚焦
     */
    focus() {
        this.rootElRef.current?.focus({ preventScroll: true });
    }

    filesSelectedChange(selected: IFile[]) {
        // console.debug("Filelist/index: filesSelectedChange", selected);
        if (selected.length > 1) {
            selected = this._removeParentFile(selected);
        }

        if (selected.length < this.props.data.length) {
            this.listTheaderRef.current?.unselectAll();
        }

        this.setState({ selected });

        const { onSelecteChange } = this.props;
        onSelecteChange?.(selected);
    }

    fileClickHandle(file: IFile) {
        if (file.name !== "..") {
            const { onFileClick } = this.props;
            onFileClick?.(file);
        }
    }

    /**
     * 文件项双击处理函数
     */
    fileDoubleClickHandle(file: IFile) {
        if (file.name === "..") {
            this._active_path = this.props.cwd;
        }
        const { onFileDoubleClick } = this.props;
        onFileDoubleClick?.(file);
    }

    /**
     * 右键菜单处理函数
     */
    contextMenuHandle(files: IFile[] | null, e: MouseEvent | React.MouseEvent) {
        const { loading } = this.props;
        e.stopPropagation();
        e.preventDefault();
        if (loading) {
            return;
        }
        const { onContextMenu } = this.props;
        onContextMenu?.(files, e);
    }

    handleHeaderContextMenu(e: React.MouseEvent) {
        e.stopPropagation();
        e.preventDefault();
        const { onTheaderContextMenu } = this.props;
        onTheaderContextMenu?.(e);
    }

    onDeleteHandle() {
        const selected = this.state.selected;
        if (selected.length === 0) {
            return;
        }
        if (selected.length === 1 && selected[0].name === "..") {
            return;
        }

        const { onDelete } = this.props;
        onDelete?.(selected);
    }

    onEnterHandle(file?: IFile) {
        let selected = this.state.selected;

        if (file) {
            selected = [file];
        }

        if (selected.length !== 1) {
            return;
        }

        if (selected[0] === this.parentFile) {
            this._active_path = this.props.cwd;
        }

        const { onEnter } = this.props;
        onEnter?.(selected[0]);
    }

    filesDropHandle(evt: IFileListDragDropEvent) {
        const { onDrop } = this.props;
        onDrop?.(evt);
    }

    /**
     * 确保activeKey的文件项可见，如果不可见则滚动到可见
     * @param {Number} activeIndex 申请可见的数据索引
     */
    ensureActiveItemVisible(activeIndex: number) {
        this.scrollToItem(activeIndex);
    }

    /**
     * 对文件列表进行排序
     */
    handleSort(sortBy: string, ascend: boolean) {
        const { props } = this;
        this.setState({
            activeKey: null,
            data: this._prepareData(
                props.data,
                ["isDir", sortBy],
                [ascend ? "desc" : "asc", ascend ? "asc" : "desc"],
                props.cwd,
                props.enableParentFile || false,
            ),
            selected: EMPTY_FILE_ARR,
            sortBy,
            sortOrderAscend: ascend,
        });
    }

    handleColResize() {
        this.setState({
            layoutTableWidth: this.caculatelayoutTableWidth(
                this.state.columns,
                this.props.enableCheckbox,
            ),
        });
    }

    handleCheckAllChange(checked: boolean) {
        if (checked) {
            this.listTbodyRef.current?.selectAll();
        } else {
            this.listTbodyRef.current?.clearSelected();
        }
    }

    caculatelayoutTableWidth(
        columns: IFileListColumn[],
        enableCheckbox?: boolean,
    ) {
        const layoutColCheckboxWidth = enableCheckbox
            ? LAYOUT_COL_CHECKBOX_WIDTH
            : 0;
        return columns
            .filter((column) => column.display)
            .reduce(
                (layoutTableWidth, column) =>
                    layoutTableWidth + (column.width || 0),
                layoutColCheckboxWidth,
            );
    }

    getMaxColsWidths() {
        return this.listTbodyRef.current?.getMaxColsWidths();
    }

    scrollTo(scrollOffset: number) {
        scrollOffset = Math.max(0, scrollOffset);

        if (this.rootElRef.current) {
            this.rootElRef.current.scrollTop = scrollOffset;
        }

        this.scrollTheaderTo(scrollOffset);

        this.setState({
            scrollOffset,
        });
    }

    scrollToItem(index: number) {
        const {
            data,
            scrollOffset,
            layoutContainerHeight: containerHeight,
        } = this.state;
        const itemCount = data.length;

        index = Math.max(0, Math.min(index, itemCount - 1));

        const lastItemOffset = Math.max(
            0,
            itemCount * LAYOUT_ROW_HEIGHT - containerHeight,
        );
        const maxOffset = Math.min(lastItemOffset, index * LAYOUT_ROW_HEIGHT);
        const minOffset = Math.max(
            0,
            index * LAYOUT_ROW_HEIGHT - containerHeight + LAYOUT_ROW_HEIGHT,
        );
        console.debug(
            "Filelist/index: scrollToItem ",
            lastItemOffset,
            maxOffset,
            minOffset,
        );

        let newScrollOffset = 0;
        if (scrollOffset >= minOffset && scrollOffset <= maxOffset) {
            newScrollOffset = scrollOffset;
        } else if (scrollOffset < minOffset) {
            newScrollOffset = minOffset;
        } else {
            newScrollOffset = maxOffset;
        }

        this.scrollTo(newScrollOffset);
    }

    scrollTheaderTo(scrollOffset: number) {
        if (!this.listTheaderRef.current) return;
        const theader = this.listTheaderRef.current.getRootDom();
        if (!theader) return;

        // 首次调用时，检测是否支持position: sticky样式
        if (
            this.rootElRef.current &&
            theader &&
            this.__support_sticky_position__ === undefined
        ) {
            const rootRect = this.rootElRef.current.getBoundingClientRect();
            const theaderRect = theader.getBoundingClientRect();
            if (rootRect.top > theaderRect.top) {
                this.__support_sticky_position__ = false;
                theader.style.position = "absolute";
            } else {
                this.__support_sticky_position__ = true;
            }
        }
        // 不支持position: sticky样式。则使用绝对定位模拟实现
        if (this.__support_sticky_position__ === false) {
            theader.style.top = `${scrollOffset}px`;
            return;
        }
    }

    _removeParentFile(selected: IFile[]) {
        const index = selected.indexOf(this.parentFile);
        if (index !== -1) {
            selected = [...selected];
            selected.splice(index, 1);
        }
        return selected;
    }
}

function guessKeybordInputCreator() {
    let keyword = "";
    const input: number[] = [];
    let resetTimer: number;
    return (keyCode: number) => {
        input.push(keyCode);
        //任意两个相邻的输入字符不同，则将连续输入的字符串作为关键字返回
        if (keyCode !== input[input.length - 2]) {
            keyword = String.fromCharCode.apply(null, input);
        } else {
            keyword = String.fromCharCode(keyCode);
        }

        //1s后重新计算连续输入值，1s以内的都算连续输入
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
            input.length = 0;
        }, 1000);
        return keyword;
    };
}
