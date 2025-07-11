import orderBy from "lodash/orderBy";
import { Component, createRef } from "react";
import { findDOMNode } from "react-dom";

import path, { posix as pathPosix } from "@/helpers/path";

import fileExtTypeMap from "./file_ext_type_map";
import tplRender from "./index.tpl";

const emptyArray = [];
const CHECKBOX_COL_WIDTH = 26;

class Filelist extends Component {
    constructor(props) {
        super(props);

        this.sortDirections = ["ascend", "descend"];
        this.path = props.isRemote ? pathPosix : path;

        this.rootElRef = createRef();
        this.listTbodyRef = createRef();
        this.listTheaderRef = createRef();

        const parentFileFullpath = this.path.resolve(props.path, "..");
        this.parentFile = {
            name: "..",
            host: props.host,
            isDir: true,
            fullpath: parentFileFullpath,
            type: "folder",
            size: 0,
            url: props.host + parentFileFullpath,
        };

        const defaultSortBy = props.defaultSortBy || "_sortName";
        const defaultSortOrder =
            props.defaultSortOrder || this.sortDirections[0];
        const defaultOrder = defaultSortOrder === "ascend" ? "asc" : "desc";
        this.state = {
            data: this._prepareData(
                props.data,
                ["isDir", defaultSortBy],
                ["desc", defaultOrder],
                props.path,
                props.hideParentFile,
            ),
            selected: emptyArray,
            defaultSortBy,
            defaultSortOrder,
            sortBy: defaultSortBy,
            ascend: defaultSortOrder === "ascend",
            disabled: props.disabled || [],
            colCheckboxWidth: props.enableCheckbox ? CHECKBOX_COL_WIDTH : 0,
            tableWidth: this.caculateTableWidth(props),
            containerHeight: 0,
            containerWidth: 0,
            scrollOffset: 0,
        };

        this.guessKeybordInput = guessKeybordInputCreator();
    }

    componentDidUpdate(prevProps) {
        const nextProps = this.props;
        if (nextProps.isRemote !== prevProps.isRemote) {
            this.path = nextProps.isRemote
                ? nodePath.posix || nodePath
                : nodePath;
        }

        if (prevProps.columns !== nextProps.columns) {
            this.setState({
                tableWidth: this.caculateTableWidth(nextProps),
            });
        }

        if (
            prevProps.host !== nextProps.host ||
            prevProps.path !== nextProps.path
        ) {
            this.parentFile.host = nextProps.host;
            this.parentFile.path =
                (nextProps.path &&
                    this.path.normalize(`${nextProps.path}/.`)) ||
                "";
            this.parentFile.fullpath = this.path.resolve(
                this.parentFile.path,
                "..",
            );
            if (
                this.parentFile.path === this.parentFile.fullpath ||
                `${this.parentFile.path}\\` === this.parentFile.fullpath
            ) {
                this.parentFile.fullpath = "/";
            }
            this.parentFile.url =
                this.parentFile.host + this.parentFile.fullpath;
            this.listTheaderRef.current?.clearSelectAll();
        }

        if (prevProps.data !== nextProps.data) {
            let activeItem;
            const data = this._prepareData(
                nextProps.data,
                ["isDir", this.state.sortBy],
                [
                    this.state.ascend ? "desc" : "asc",
                    this.state.ascend ? "asc" : "desc",
                ],
                nextProps.path,
                nextProps.hideParentFile,
            );
            if (this._active_path) {
                activeItem = data.find(
                    (item) => item.fullpath === this._active_path,
                );
            } else if (prevProps.copyPath && prevProps.copyPath.length > 0) {
                activeItem = [];
                data.forEach((item) => {
                    prevProps.copyPath.forEach((file) => {
                        if (item.name === file.name || item.name === file) {
                            activeItem.push(item);
                        }
                    });
                });
                this.rootMouseDownHandle();
            } else if (
                nextProps.defaultSelected &&
                nextProps.defaultSelected.length > 0
            ) {
                activeItem = [];
                nextProps.defaultSelected.forEach((selectedkey) => {
                    const tarData = data.find(
                        (file) => file.fullpath === selectedkey,
                    );
                    if (tarData) {
                        activeItem.push(tarData);
                    }
                });
            }
            this.setState({
                selected: activeItem
                    ? Array.isArray(activeItem) && activeItem.length > 0
                        ? activeItem
                        : [activeItem]
                    : emptyArray,
                activeKey: activeItem?.fullpath || null,
                data: data,
            });
            this._active_path = null;
            this.listTheaderRef.current?.clearSelectAll();
        }

        if (nextProps.disabled !== prevProps.disabled) {
            if (nextProps.copyPath.length > 0) {
                this.setState({
                    disabled: nextProps.disabled,
                    selected: nextProps.copyPath,
                });
            } else {
                this.setState({
                    disabled: nextProps.disabled,
                });
            }
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
        const update = (size) => {
            const rootEl = this.rootElRef.current;
            const theader = findDOMNode(this.listTheaderRef.current);
            const theaderRect = theader.getBoundingClientRect();
            const scrollTop = rootEl.scrollTop;
            const { scrollOffset } = this.state;
            if (scrollTop !== scrollOffset) {
                this.scrollTo(scrollTop);
            }
            this.setState({
                containerWidth: size.width,
                containerHeight: size.height - theaderRect.height,
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
        this._resizeObserver.observe(rootEl);
        update(rootEl.getBoundingClientRect());
    }

    componentWillUnmount() {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
    }

    render() {
        return tplRender.call(this);
    }

    scrollHandle(evt) {
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
     * 请求失败时重新刷新页面
     */
    onClickRefresh() {
        const { onRefresh, path } = this.props;
        if (onRefresh) {
            onRefresh(path);
        }
    }

    onBackHomedirHandle() {
        const { onBackHomedirHandle } = this.props;
        onBackHomedirHandle?.();
    }

    /**
     * 处理data，增加一些组件需要的数据
     */
    _prepareData(data, iteratees, orders, path, hideParentFile) {
        const newData = orderBy(
            data.map((item) => {
                var file = Object.assign({}, item);
                if (file.isVolume) {
                    file.type = "harddisk";
                } else if (file.isDir) {
                    file.type = "folder";
                } else {
                    const ext = getFileExt(file.name);
                    file.type = fileExtTypeMap[ext] || "unknow";
                }

                file._sortName = file.name.toLowerCase();
                return file;
            }),
            iteratees,
            orders,
        );
        if (path !== "/" && path !== "\\" && !hideParentFile) {
            newData.unshift(this.parentFile);
        }
        return newData;
    }

    /**
     * 组件根节点键盘事件处理函数
     */
    rootKeyDownHandle(e) {
        const { enableKeyCopy } = this.props;
        var keyCode = e.keyCode;
        switch (true) {
            case keyCode === 8: // back
                e.preventDefault();
                return this.onEnterHandle(this.parentFile);
            case keyCode === 13: // enter
                return this.onEnterHandle();
            case keyCode === 46: // delete
                return this.onDeleteHandle();
            case e.ctrlKey && keyCode === 65: // ctrl a
            case e.metaKey && keyCode === 65: // mac command a
                e.preventDefault();
                return this.listTbodyRef.current?.selectAll();
            case e.ctrlKey && keyCode === 88:
            case e.metaKey && keyCode === 88:
                return enableKeyCopy && this.handleCut(); //选中后ctrl+x剪切
            case e.ctrlKey && keyCode === 67:
            case e.metaKey && keyCode === 67:
                return enableKeyCopy && this.handleCopy(); //选中后ctrl+c复制
            case e.ctrlKey && keyCode === 86:
            case e.metaKey && keyCode === 86:
                return enableKeyCopy && this.handlePaste(); //选中后ctrl+v粘贴
            case !e.shiftKey && keyCode === 38: // up arrow
            case !e.shiftKey && keyCode === 40: // down arrow
                e.preventDefault();
                return this.listTbodyRef.current?.selectNext(e.keyCode === 38);
            case (keyCode >= 48 && keyCode <= 57) ||
                (keyCode >= 65 && keyCode <= 90): //0-9 && a-z
                return this.listTbodyRef.current?.selectByKeyword(
                    this.guessKeybordInput(keyCode),
                );
            case e.shiftKey && keyCode === 38: // shift up arrow
            case e.shiftKey && keyCode === 40: // shift down arrow
                return this.listTbodyRef.current?.shiftSelectNext(
                    e.keyCode === 38,
                );
            case keyCode === 113: // F2重命名
                return this.handleRename?.(); // 选中后重命名
            default:
                return;
        }
    }

    /** 重命名 */
    handleRename() {
        const { onRename, path } = this.props;
        const { selected } = this.state;
        if (!selected) return;
        if (selected.length === 1 && selected[0].name === "..") {
            return;
        }

        // 仿照windows，多选时默认修改最后一个文件名
        const last = selected[selected.length - 1];
        onRename?.(last, path);
    }

    /**
     * 剪切ctrl+x
     */
    handleCut() {
        const { selected } = this.state;
        if (selected.length === 1 && selected[0].name === "..") {
            return;
        }
        this.setState({
            disabled: selected,
        });

        this.handleCopy(true);
    }

    /**
     * 选中ctrl+c
     */
    handleCopy(isCut) {
        const { selected } = this.state;
        const { onCopy, host, fileUrl } = this.props;
        if (selected.length === 1 && selected[0].name === "..") {
            return;
        }

        let pasteData;
        if (selected.length > 0) {
            pasteData = {
                copyTarget: {
                    host,
                    fileUrl,
                    files: selected,
                    type: isCut ? "cut" : "copy",
                },
            };
        }
        !isCut &&
            this.setState({
                disabled: [],
            });

        onCopy && pasteData !== undefined && onCopy(pasteData);
    }

    /**
     * 选中ctrl+v
     */
    handlePaste() {
        const { onPaste, pasteData } = this.props;
        if (
            onPaste &&
            pasteData.copyTarget &&
            Array.isArray(pasteData.copyTarget.files) &&
            pasteData.copyTarget.files.length > 0
        ) {
            onPaste(pasteData);
        }
    }

    /**
     * 组件根节点鼠标按下事件处理函数。focus组件，之后就能捕捉键盘事件了
     */
    rootMouseDownHandle() {
        this.rootElRef.current.focus({ preventScroll: true });
    }

    /**
     * 使filelist组件聚焦
     */
    focus() {
        this.rootElRef.current.focus({ preventScroll: true });
    }

    filesSelectedChange(selected) {
        console.debug("Filelist/index: filesSelectedChange", selected);
        if (selected.length > 1) {
            // eslint-disable-next-line no-param-reassign
            selected = this._removeParentFile(selected);
        }

        if (selected.length < this.props.data.length) {
            this.listTheaderRef.current?.clearSelectAll();
        }

        this.setState({ selected });

        const { onSelecteChange } = this.props;
        onSelecteChange?.(selected);
    }

    fileClickHandle(file) {
        if (file.name !== "..") {
            const { onFileClick } = this.props;
            onFileClick?.(file);
        }
    }

    /**
     * 文件项双击处理函数
     */
    fileDoubleClickHandle(file) {
        if (file.name === "..") {
            this._active_path = this.props.path;
        }
        const { onFileDoubleClick } = this.props;
        onFileDoubleClick?.(file);
    }

    /**
     * 右键菜单处理函数
     */
    contextMenuHandle(files, e) {
        const { loading } = this.props;
        e.stopPropagation();
        e.preventDefault();
        if (loading) {
            return;
        }
        const { onContextMenu } = this.props;
        onContextMenu?.(files, e);
    }

    handleHeaderContextMenu(e) {
        e.stopPropagation();
        e.preventDefault();
        const { onTheaderContextMenu } = this.props;
        onTheaderContextMenu?.(e);
    }

    onDeleteHandle() {
        var selected = this.state.selected;
        if (selected.length === 0) {
            return;
        }
        if (selected.length === 1 && selected[0].name === "..") {
            return;
        }

        const { onDelete } = this.props;
        onDelete?.(selected);
    }

    onEnterHandle(file) {
        var selected = this.state.selected;

        if (file) {
            selected = [file];
        }

        if (selected.length !== 1) {
            return;
        }

        if (selected[0] === this.parentFile) {
            this._active_path = this.props.path;
        }

        const { onEnter } = this.props;
        onEnter?.(selected[0]);
    }

    filesDropHandle(e) {
        const { onDrop } = this.props;
        onDrop?.(e);
    }

    /**
     * 确保activeKey的文件项可见，如果不可见则滚动到可见
     * @param {Number} activeIndex 申请可见的数据索引
     */
    ensureActiveItemVisible(activeIndex) {
        this.scrollToItem(activeIndex);
    }

    /**
     * 对文件列表进行排序
     */
    handleSort(sortBy, ascend) {
        const { props } = this;
        this.setState({
            data: this._prepareData(
                props.data,
                ["isDir", sortBy],
                [ascend ? "desc" : "asc", ascend ? "asc" : "desc"],
                props.path,
                props.hideParentFile,
            ),
            sortBy,
            ascend,
            selected: emptyArray,
            activeKey: null,
        });
    }

    tableColResizeHandle() {
        const { onColResize } = this.props;
        onColResize?.();
        this.setState({
            tableWidth: this.caculateTableWidth(this.props),
        });
    }

    handleCheckAllChange(checked) {
        if (checked) {
            this.listTbodyRef.current.selectAll();
        } else {
            this.listTbodyRef.current.clearSelected();
        }
    }

    caculateTableWidth(nextProps) {
        const { columns, enableCheckbox } = nextProps;
        const colCheckboxWidth = enableCheckbox ? CHECKBOX_COL_WIDTH : 0;
        return columns
            .filter((column) => column.display)
            .reduce(
                (tableWidth, column) => tableWidth + (column.width || 0),
                colCheckboxWidth,
            );
    }

    getMaxColsWidths() {
        return this.listTbodyRef.current.getMaxColsWidths();
    }

    scrollTo(scrollOffset) {
        // eslint-disable-next-line no-param-reassign
        scrollOffset = Math.max(0, scrollOffset);

        if (this.rootElRef.current) {
            this.rootElRef.current.scrollTop = scrollOffset;
        }

        this.scrollTheaderTo(scrollOffset);

        this.setState({
            scrollOffset,
        });
    }

    scrollToItem(index) {
        const { itemHeight } = this.props;
        const { data, scrollOffset, containerHeight } = this.state;
        const itemCount = data.length;

        // eslint-disable-next-line no-param-reassign
        index = Math.max(0, Math.min(index, itemCount - 1));

        const size = containerHeight;
        const lastItemOffset = Math.max(0, itemCount * itemHeight - size);
        const maxOffset = Math.min(lastItemOffset, index * itemHeight);
        const minOffset = Math.max(0, index * itemHeight - size + itemHeight);
        console.debug(
            "Filelist/index: scrollToItem ",
            lastItemOffset,
            maxOffset,
            minOffset,
        );

        let newScrollOffset;
        if (scrollOffset >= minOffset && scrollOffset <= maxOffset) {
            newScrollOffset = scrollOffset;
        } else if (scrollOffset < minOffset) {
            newScrollOffset = minOffset;
        } else {
            newScrollOffset = maxOffset;
        }

        this.scrollTo(newScrollOffset);
    }

    scrollTheaderTo(scrollOffset) {
        if (this.listTheaderRef.current) {
            const theader = findDOMNode(this.listTheaderRef.current);
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
    }

    _removeParentFile(selected) {
        const index = selected.indexOf(this.parentFile);
        if (index !== -1) {
            // eslint-disable-next-line no-param-reassign
            selected = [].concat(selected);
            selected.splice(index, 1);
        }
        return selected;
    }
}

Filelist.defaultProps = {
    className: "",
    data: [],
    path: "",
    tabIndex: "-1",
    itemHeight: 24,
    loading: true,
    draggable: false,
    emptyContent: null,
    hideParentFile: false,
    enableKeyCopy: true,
    enableCheckbox: true,
    defaultSelected: [],
    onSelecteChange: null,
    onFileClick: null,
    onFileDoubleClick: null,
    onContextMenu: null,
    onDrop: null,
    onEnter: null,
    onDelete: null,
    pasteData: {},
    onCopy: null,
    onPaste: null,
    onCut: null,
};

function getFileExt(filename) {
    var arr = filename.split(".");
    return arr[arr.length - 1].toLowerCase();
}

function guessKeybordInputCreator() {
    var keyword;
    var input = [];
    var resetTimer;
    return (keyCode) => {
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

export default Filelist;
