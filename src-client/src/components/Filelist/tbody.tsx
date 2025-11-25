import { Component, createRef } from "react";

import DragFilesReader from "@/helpers/DragFilesReader";

import type { IViewFileStat } from "@/types";
import type { IFileListColumn, IFileListDragDropEvent } from "./types";

const EMPTY_FILE_ARR: IViewFileStat[] = [];
const MOUSE_SELECTION_ELID = "__filelist_mouse_selection__";

function addClass(elem: HTMLElement, value: string) {
    elem.classList.add(value);
}

function removeClass(elem: HTMLElement, value: string) {
    elem.classList.remove(value);
}

function preventDefault(e: Event) {
    e.preventDefault();
}

interface IProps {
    scrollOffset?: number;
    layoutRowHeight?: number;
    layoutContainerWidth: number;
    layoutContainerHeight?: number;
    layoutTableWidth: number;
    layoutColCheckboxWidth?: number;
    tbodyScrollOffset?: number;
    draggable?: boolean;
    parentFile?: IViewFileStat;
    columns: IFileListColumn[];
    data: IViewFileStat[];
    cwd?: string;
    selected?: IViewFileStat[];
    activeKey?: string | null;
    enableCheckbox?: boolean;
    enableDragFromOS?: boolean;
    onSelected?: (files: IViewFileStat[]) => void;
    onFileClick?: (file: IViewFileStat) => void;
    onFileDoubleClick?: (file: IViewFileStat, evt: MouseEvent) => void;
    onContextMenu?: (files: IViewFileStat[] | null, evt: MouseEvent) => void;
    onActive?: (activeIndex: number) => void;
    onDrop?: (evt: IFileListDragDropEvent) => void;
}

interface IState {
    data: IViewFileStat[];
    selected: IViewFileStat[];
    activeKey?: string | null;
    dragFiles?: IViewFileStat[] | null;
    dropDir?: IViewFileStat | null;
    lasterSelected?: IViewFileStat | null;
    // 拖拽文件时移入区域的文件路劲，用于显示hover效果
    dropFileHover?: string | null;
    tbodyScrollOffset?: number;
}

export default class Tbody extends Component<IProps, IState> {
    static defaultProps = {
        data: [],
        selected: [],
        activeKey: null,
        draggable: false,
        enableCheckbox: true,
        onActive: null,
        onContextMenu: null,
        onDrop: null,
        onFileClick: null,
        onFileDoubleClick: null,
        onSelected: null,
    };

    rootElRef: React.RefObject<HTMLDivElement> = createRef();
    tableElRef: React.RefObject<HTMLTableElement> = createRef();
    tbodyElRef: React.RefObject<HTMLTableSectionElement> = createRef();
    colgroupRef: React.RefObject<HTMLTableColElement> = createRef();
    _refs: Record<string, HTMLTableRowElement> = {};
    //标记是否执行mouseMove事件
    _isMove: boolean = false;
    //标记是否执行mouseUp事件
    _isUp: boolean = false;
    //鼠标按下时的初始X坐标
    _startMouseDownX: number = 0;
    //鼠标按下时的初始Y坐标
    _startMouseDownY: number = 0;
    //记录开始时的tr下标
    _startSelectDataIndex: number = -1;
    //记录虚拟滚动的开始数据索引
    _startRenderDataIndex: number = 0;
    _lastKeyword: string = "";
    _lastFilteredCache: IViewFileStat[] | null = null;
    _lastFilteredIndex: number = -1;
    _startMouseDownInBlank: boolean = false;
    _dragTarget: IFileListDragDropEvent["dragTarget"] | null = null;
    _dragLeaveTimer: number | undefined;
    _lastRenderData?: IViewFileStat[];

    constructor(props: IProps) {
        super(props);

        this.state = {
            data: [],
            activeKey: props.activeKey || null,
            dragFiles: null,
            dropDir: null,
            // 拖拽文件时移入区域的文件路劲，用于显示hover效果
            dropFileHover: null,
            lasterSelected: null,
            selected: props.selected || EMPTY_FILE_ARR,
            ...this.caculateData({
                data: props.data,
                layoutRowHeight: props.layoutRowHeight || 0,
                layoutContainerHeight: props.layoutContainerHeight || 0,
                scrollOffset: props.scrollOffset || 0,
            }),
        };
    }

    shouldComponentUpdate(nextProps: IProps, nextState: IState) {
        const { props } = this;
        const { onSelected, columns, layoutContainerWidth, layoutTableWidth } =
            props;

        /* 属性改变，重新生成某些状态 */
        if (
            props.data !== nextProps.data ||
            props.layoutContainerHeight !== nextProps.layoutContainerHeight ||
            props.scrollOffset !== nextProps.scrollOffset ||
            props.layoutRowHeight !== nextProps.layoutRowHeight
        ) {
            const newRendeDataState = this.caculateData({
                data: nextProps.data,
                layoutRowHeight: nextProps.layoutRowHeight || 0,
                layoutContainerHeight: nextProps.layoutContainerHeight || 0,
                scrollOffset: nextProps.scrollOffset || 0,
            });
            if (newRendeDataState) {
                this.setState(newRendeDataState);
            }

            this._lastKeyword = "";
            this._lastFilteredCache = null;
            this._lastFilteredIndex = -1;
        }
        if (props.activeKey !== nextProps.activeKey) {
            this.setState({ activeKey: nextProps.activeKey });
        }
        if (props.selected !== nextProps.selected && nextProps.selected) {
            this.setState({ selected: nextProps.selected });
        }

        if (
            columns !== nextProps.columns ||
            layoutContainerWidth !== nextProps.layoutContainerWidth ||
            layoutTableWidth !== nextProps.layoutTableWidth
        ) {
            this._refreshColgroup(nextProps);
        }

        /* 状态改变，刷新页面 */
        const {
            data,
            activeKey,
            selected,
            dragFiles,
            dropDir,
            lasterSelected,
            dropFileHover,
        } = this.state;
        if (data !== nextState.data || columns !== nextProps.columns) {
            this._refreshList(nextProps, nextState);
        }

        if (
            data !== nextState.data ||
            activeKey !== nextState.activeKey ||
            selected !== nextState.selected ||
            dragFiles !== nextState.dragFiles ||
            dragFiles !== nextState.dragFiles ||
            dropDir !== nextState.dropDir ||
            lasterSelected !== nextState.lasterSelected ||
            dropFileHover !== nextState.dropFileHover
        ) {
            this._highlightSelected(nextProps, nextState);
        }

        /* 状态改变，向上冒泡事件 */
        if (nextState.selected !== selected && nextState.selected) {
            onSelected?.(nextState.selected);
        }

        return false;
    }

    componentDidMount() {
        const rootEl = this.rootElRef.current;
        if (!rootEl) return;
        this.documentMouseUpHandle = this.documentMouseUpHandle.bind(this);
        rootEl.ondragenter = this.dragEnterHandle.bind(this, null);
        rootEl.ondragleave = this.dragLeaveHandle.bind(this);
        rootEl.ondragover = this.dragOverHandle.bind(this);
        rootEl.ondragend = this.dragEndHandle.bind(this);
        rootEl.ondrop = this.dropHandle.bind(this, null);
        document.addEventListener("mouseup", this.documentMouseUpHandle, true);

        this._refreshColgroup(this.props);
        this._refreshList(this.props, this.state);
    }

    componentWillUnmount() {
        // @ts-expect-error
        this._refs = null;

        document.removeEventListener(
            "mouseup",
            this.documentMouseUpHandle,
            true,
        );

        const rootEl = this.rootElRef.current;
        if (!rootEl) return;

        rootEl.ondragenter = null;
        rootEl.ondragover = null;
        rootEl.ondrop = null;
    }

    render() {
        const { layoutTableWidth } = this.props;
        return (
            <div
                ref={this.rootElRef}
                className="filelistTableBodyWrapper"
                onMouseDown={this.mouseDownHandle.bind(this)}
                onMouseMove={this.mouseMoveHandle.bind(this)}
                onMouseUp={this.mouseUpHandle.bind(this)}
            >
                <table
                    ref={this.tableElRef}
                    className="filelistTable filelistTableBody"
                    style={{ width: layoutTableWidth }}
                >
                    <colgroup ref={this.colgroupRef} />
                    <tbody ref={this.tbodyElRef} />
                </table>
            </div>
        );
    }

    _refreshColgroup(nextProps: IProps) {
        const {
            columns,
            layoutContainerWidth,
            layoutTableWidth,
            enableCheckbox,
            layoutColCheckboxWidth,
        } = nextProps;
        const colgroup = this.colgroupRef.current;
        if (!colgroup || !columns) {
            return;
        }
        colgroup.innerHTML = "";

        if (enableCheckbox) {
            const col0 = document.createElement("col");
            col0.style.width = `${layoutColCheckboxWidth}px`;
            colgroup.appendChild(col0);
        }

        columns.forEach((column) => {
            if (!column.display) return;

            const col = document.createElement("col");
            col.style.width = `${column.width || 0}px`;
            colgroup.appendChild(col);
        });

        const tbodyWrapperWidth =
            layoutContainerWidth < layoutTableWidth
                ? layoutTableWidth
                : layoutContainerWidth;
        if (this.rootElRef.current) {
            this.rootElRef.current.style.width = `${tbodyWrapperWidth}px`;
        }
        if (this.tableElRef.current) {
            this.tableElRef.current.style.width = `${layoutTableWidth}px`;
        }
    }

    _refreshList(nextProps: IProps, nextState: IState) {
        console.debug("Filelist/Tbody: _refreshList");
        const {
            columns,
            enableCheckbox,
            layoutRowHeight,
            layoutContainerHeight,
            draggable,
        } = nextProps;
        const { data, tbodyScrollOffset } = nextState;
        const tbody = this.tbodyElRef.current;
        if (
            !tbody ||
            !columns ||
            !data ||
            !layoutContainerHeight ||
            !layoutRowHeight ||
            !nextProps.data ||
            !this.rootElRef.current ||
            !this.tableElRef.current
        ) {
            return;
        }

        var tmpDoc = document.createDocumentFragment();
        tbody.innerHTML = "";
        this._refs = {};

        this.rootElRef.current.style.height = `${Math.max(layoutContainerHeight, nextProps.data.length * layoutRowHeight + 10)}px`;
        this.tableElRef.current.style.top = `${tbodyScrollOffset}px`;

        data.forEach((item, i) => {
            const isParentFile = i === 0 && item.name === "..";
            const tr = document.createElement("tr");
            tr.style.height = `${layoutRowHeight}px`;

            if (enableCheckbox) {
                const td0 = document.createElement("td");
                td0.className = "filelistTableCellColCheckbox";

                if (!isParentFile) {
                    const checkbox = document.createElement("input");
                    checkbox.setAttribute("type", "checkbox");
                    checkbox.onclick = preventDefault;
                    td0.appendChild(checkbox);
                }

                tr.appendChild(td0);
            }

            columns.forEach((column) => {
                if (!column.display) return;

                const td = document.createElement("td");
                td.className = column.className || "";
                if (typeof column.render === "function") {
                    td.innerHTML = column.render(
                        // @ts-expect-error
                        item[column.dataIndex],
                        item,
                        i,
                    );
                } else {
                    // @ts-expect-error
                    td.innerHTML = item[column.dataIndex];
                }
                td.style.textAlign = column.align || "left";
                tr.appendChild(td);
            });

            tr.ondblclick = this.fileDoubleClickHandle.bind(this, item);
            tr.ondragend = this.dragEndHandle.bind(this);
            tr.ondragenter = this.dragEnterHandle.bind(this, item);
            tr.ondragover = this.dragOverHandle.bind(this);
            tr.ondrop = this.dropHandle.bind(this, item);

            if (!isParentFile) {
                tr.oncontextmenu = this.contextMenuHandle.bind(this, item);
                tr.ondragstart = this.dragStartHandle.bind(this, item);
                if (draggable) {
                    tr.setAttribute("draggable", "true");
                }
            }

            tmpDoc.appendChild(tr);
            this._refs[item.uri] = tr;
        });

        tbody.appendChild(tmpDoc);
    }

    /** 鼠标框选——鼠标按下事件 */
    mouseDownHandle(e: MouseEvent | React.MouseEvent) {
        if (e.button === 0 && e.currentTarget === this.rootElRef.current) {
            //获得按下的位置
            this._startMouseDownX = e.clientX;
            this._startMouseDownY = e.clientY;
            this._startSelectDataIndex = -1; //有效的tr下标从0开始，-1代表非tr
            const target = e.target as Element;
            const targetTr = this._getTr(target);

            if (targetTr) {
                this._startSelectDataIndex =
                    targetTr.rowIndex + this._startRenderDataIndex;
            } else {
                this._startMouseDownInBlank = true;
                this._startSelectDataIndex = this._getMousePositionDataIndex(
                    e.clientY,
                );
                console.debug(
                    `Filelist/Tbody: mouseDownHandle on blank area this._startSelectDataIndex ${this._startSelectDataIndex} `,
                    this.props.data[this._startSelectDataIndex]?.name,
                );
            }

            const selectedFile = this.state.data[this._startSelectDataIndex]; //得到按下的file

            //1.快捷键多选。
            //2.点击在文件名上时，要么是单击，要么是拖拽，不可能是框选
            //3.点击在非文件名上且已经是选中状态，则一定是拖拽。注意：不能在这里设置拖拽属性，因为设置后，当这些文件取消选中后没有及时去掉拖拽属性
            if (
                e.metaKey ||
                e.ctrlKey ||
                e.shiftKey ||
                target.nodeName === "SPAN" ||
                (selectedFile &&
                    target.nodeName === "TD" &&
                    this.state.selected.some(
                        (item) => item.name === selectedFile.name,
                    ))
            ) {
                this._isUp = true;
                this._isMove = false;
            } else {
                //框选/单击(点击在非文件名且不是已选中状态)。说明：此时还不能确定是框选行为还是单击行为，需进入mouseMove事件
                this._isUp = true;
                this._isMove = true;
                this._dragTarget = null;
            }
        }
    }

    /** 鼠标框选——鼠标抬起事件 */
    mouseUpHandle(e: MouseEvent | React.MouseEvent) {
        // console.debug("Filelist/Tbody: mouseUpHandle");
        if (this._isUp) {
            const { parentFile } = this.props;
            const { data } = this.props;
            let _endSelectDataIndex = -1; //有效的tr下标从0开始，-1代表非tr
            const target = e.target as Element;
            const targetTr = this._getTr(target);

            if (targetTr) {
                _endSelectDataIndex =
                    targetTr.rowIndex + this._startRenderDataIndex;
            } else if (!this._startMouseDownInBlank) {
                _endSelectDataIndex = this._getMousePositionDataIndex(
                    e.clientY,
                );
            }
            console.debug(
                `Filelist/Tbody: mouseUpHandle _startMouseDownInBlank ${this._startMouseDownInBlank} _startSelectDataIndex ${this._startSelectDataIndex}, _endSelectDataIndex ${_endSelectDataIndex} `,
            );
            if (
                this._startSelectDataIndex === _endSelectDataIndex &&
                _endSelectDataIndex > -1
            ) {
                const file =
                    _endSelectDataIndex < 0
                        ? parentFile
                        : data[_endSelectDataIndex];
                if (file) {
                    this.fileClickHandle(file, _endSelectDataIndex, e);
                }
            } else if (
                this._startMouseDownInBlank &&
                _endSelectDataIndex === -1
            ) {
                this.setState({
                    activeKey: null,
                    lasterSelected:
                        this.state.selected[this.state.selected.length - 1],
                    selected: [],
                });
            }

            this._isUp = false;
            this._isMove = false;
            this._startMouseDownInBlank = false;
        }
    }

    /** 鼠标框选——鼠标移动事件 */
    mouseMoveHandle(e: MouseEvent | React.MouseEvent) {
        if (
            e.button === 0 &&
            this._isMove &&
            this._startMouseDownY !== e.clientY
        ) {
            this._updateMouseSelection(e.clientX, e.clientY);
            const { data } = this.props;
            // 选中的结束数据的索引
            let _endSelectDataIndex = -1;
            let targetTr: HTMLTableRowElement | null = null;
            if (this._isEventTargetInMouseSelection(e)) {
                if (this._isMousePositionInTable(e.clientX, e.clientY)) {
                    // 鼠标坐标在数据表格区域内时
                    _endSelectDataIndex = this._getMousePositionDataIndex(
                        e.clientY,
                    );
                }
            } else {
                targetTr = this._getTr(e.target);
            }
            if (targetTr) {
                _endSelectDataIndex =
                    targetTr.rowIndex + this._startRenderDataIndex;
            } else {
                if (!this._startMouseDownInBlank) {
                    _endSelectDataIndex = this._getMousePositionDataIndex(
                        e.clientY,
                    );
                }
            }

            let newSelected: IViewFileStat[] = EMPTY_FILE_ARR;
            if (
                this._startSelectDataIndex > -1 &&
                _endSelectDataIndex > -1 &&
                data
            ) {
                if (this._startSelectDataIndex > _endSelectDataIndex) {
                    newSelected = data
                        .slice(
                            _endSelectDataIndex,
                            this._startSelectDataIndex + 1,
                        )
                        .reverse();
                } else if (this._startSelectDataIndex < _endSelectDataIndex) {
                    newSelected = data.slice(
                        this._startSelectDataIndex,
                        _endSelectDataIndex + 1,
                    );
                }
            }

            if (newSelected) {
                this.setState({
                    activeKey: null,
                    lasterSelected: null,
                    selected: newSelected,
                });
            }
        }
    }

    documentMouseUpHandle(e: MouseEvent) {
        if (
            !(
                this._isEventTargetInThisRoot(e) &&
                this._isEventTargetInMouseSelection(e)
            )
        ) {
            this._startMouseDownInBlank = false;
        }
        this._isMove = false;
        this._hideMouseSelection();
    }

    _isEventTargetIn(
        e: MouseEvent | React.MouseEvent,
        targetEl: Element | null,
    ) {
        let parent = e.target as ParentNode | null;
        let result = false;
        while (parent) {
            if (parent === targetEl) {
                result = true;
                break;
            } else if (parent === document.body) {
                result = false;
                break;
            }
            parent = parent.parentNode;
        }
        return result;
    }

    _isEventTargetInThisRoot(e: MouseEvent | React.MouseEvent) {
        return this._isEventTargetIn(e, this.rootElRef.current);
    }

    _isEventTargetInMouseSelection(e: MouseEvent | React.MouseEvent) {
        const mouseSelectionEl = document.getElementById(MOUSE_SELECTION_ELID);
        return this._isEventTargetIn(e, mouseSelectionEl);
    }

    _isMousePositionInTable(mouseX: number, mouseY: number) {
        if (!this.tableElRef.current) return false;
        const tableRect = this.tableElRef.current.getBoundingClientRect();
        if (mouseX > tableRect.right || mouseY > tableRect.bottom) {
            return false;
        }
        return true;
    }

    _getMousePositionDataIndex(mouseY: number) {
        if (
            !this.rootElRef.current ||
            !this.props.layoutRowHeight ||
            !this.props.data
        ) {
            return -1;
        }

        const rootRect = this.rootElRef.current.getBoundingClientRect();

        let _endSelectDataIndex = Math.floor(
            (mouseY - rootRect.y) / this.props.layoutRowHeight,
        );
        _endSelectDataIndex = Math.min(
            _endSelectDataIndex,
            this.props.data.length - 1,
        );
        _endSelectDataIndex = Math.max(_endSelectDataIndex, 0);

        return _endSelectDataIndex;
    }

    /**
     * 文件项点击处理函数
     */
    fileClickHandle(
        file: IViewFileStat,
        index: number,
        e: MouseEvent | React.MouseEvent,
    ) {
        const { onFileClick } = this.props;
        const parentFile = this.props.parentFile;
        let selected = this.state.selected || [];
        const preSelected = selected;
        const data = this.props.data;
        const evtTarget = e.target as Element;
        const isAppendClick =
            // @ts-expect-error
            evtTarget.type === "checkbox" ||
            (evtTarget.children[0] &&
                // @ts-expect-error
                evtTarget.children[0].type === "checkbox") ||
            e.metaKey ||
            e.ctrlKey;

        if (isAppendClick) {
            // 多选不允许选中 `parentFile` 即 `..`目录.
            // 所以如果当前点击的`parentFile`目录,则忽略.
            // 如果之前选中的文件中包含`parentFile`, 则从selected数组中移除
            if (file === parentFile) {
                return;
            }
            // 如果当前点击的文件已经包含在selected中, 则取消选择该文件
            // 否则就将该文件加入到selected中
            const _index = selected.indexOf(file);
            if (_index === -1) {
                // @ts-expect-error
                selected = [].concat(selected, file);
            } else {
                // @ts-expect-error
                selected = [].concat(selected);
                selected.splice(_index, 1);
            }
        } else if (e.shiftKey && selected.length > 0 && data) {
            // 选中当前选中的第一条与当前点击的行数之间的所有行
            const firstSelected = selected[0];
            const firstSelectedIndex = data.indexOf(firstSelected);
            if (firstSelectedIndex > index) {
                // 如果当前点击的行在当前选中的第一条之上, 则将倒序存储, 使下标最大的一行成为selected中第一个元素
                // 这样是为了实现类似window和mac中按住shift, 连续往上或往下,追加选择, 以及向相反方向点击后的反选操作
                selected = data
                    .slice(Math.max(0, index), firstSelectedIndex + 1)
                    .reverse();
            } else {
                selected = data.slice(
                    Math.max(0, firstSelectedIndex),
                    index + 1,
                );
            }
        } else {
            onFileClick?.(file);
            selected = [file];
        }

        if (
            !(
                preSelected.length === 1 &&
                preSelected[0] === file &&
                !isAppendClick
            )
        ) {
            this.setState({ activeKey: null, lasterSelected: null, selected });
        }
    }

    /**
     * 文件项双击处理函数
     */
    fileDoubleClickHandle(file: IViewFileStat, e: MouseEvent) {
        const { onFileDoubleClick } = this.props;
        onFileDoubleClick?.(file, e);
    }

    /**
     * 右键菜单处理函数
     */
    contextMenuHandle(file: IViewFileStat, e: MouseEvent) {
        e.stopPropagation();
        e.preventDefault();
        const { onContextMenu } = this.props;
        if (!onContextMenu) {
            return false;
        }

        let selected = this.state.selected || [];
        //已经选中点TD也默认选中
        const isSelect = selected.some((item) => item.name === file.name);

        //判断菜单是否需要拼接前面
        if (
            // @ts-expect-error
            e.target.nodeName !== "TD" ||
            isSelect
        ) {
            if (selected.indexOf(file) === -1) {
                selected = [file];
                this.setState({
                    activeKey: null,
                    lasterSelected: null,
                    selected,
                });
            }
        } else {
            selected = [];
            this.setState({
                lasterSelected: selected[selected.length - 1],
                selected: [],
            });
        }

        onContextMenu(selected, e);
    }

    /**
     * 选中键盘上下箭头键指向的下一个文件项
     */
    dragStartHandle(file: IViewFileStat, e: DragEvent) {
        this._isUp = false;
        this._isMove = false;
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "copyMove";
        }

        const selected = this.state.selected || [];
        const newState = {
            dragFiles: selected,
        };

        if (selected.indexOf(file) !== -1) {
            //TODO: 拖动多个文件时的界面视觉效果
        } else {
            newState.dragFiles = [file];
            // @ts-expect-error
            newState.selected = [file];
        }

        this.setState(newState);

        this._dragTarget = {
            files: newState.dragFiles,
            fileUri: this.props.cwd,
        };
        if (e.dataTransfer) {
            e.dataTransfer.setData(
                "drag-target",
                JSON.stringify(this._dragTarget),
            );
        }
    }

    dragEnterHandle(file: IViewFileStat | null, e: DragEvent) {
        e.stopPropagation();

        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = this._dragTarget ? "move" : "copy";
        }

        if (file) {
            if (this.state.dropFileHover === file.uri) {
                return;
            }
            this.setState({
                dropFileHover: file.uri,
            });
        }

        // if (file && file.isDir && !(this._dragTarget && this._dragTarget.files.length === 1 && this._dragTarget.files[0] === file)) {
        //     this.setState({
        //         dropDir: file
        //     });
        // } else {
        //     this.setState({
        //         dropDir: null
        //     });
        // }
    }

    dragLeaveHandle(_e: DragEvent) {
        // clearTimeout(this._dragLeaveTimer);
        // this._dragLeaveTimer = setTimeout(() => this.setState({ dropDir: null }), 50);
    }

    dragOverHandle(e: DragEvent) {
        e.stopPropagation();
        e.preventDefault();
        clearTimeout(this._dragLeaveTimer);
        if (!e.dataTransfer) return;

        if (e.dataTransfer.files.length > 0 && !this.props.enableDragFromOS) {
            e.dataTransfer.dropEffect = "none";
            return;
        }

        if (this._dragTarget) {
            e.dataTransfer.dropEffect = "move";
        } else {
            e.dataTransfer.dropEffect = "copy";
        }
    }

    dragEndHandle(_e: DragEvent) {
        clearTimeout(this._dragLeaveTimer);
        this.setState({
            dragFiles: null,
            dropDir: null,
            dropFileHover: null,
        });
    }

    dropHandle(file: IViewFileStat | null, e: DragEvent) {
        e.stopPropagation();
        e.preventDefault();
        const { onDrop, enableDragFromOS, cwd: fileUri } = this.props;
        const dragEvent = new Event("file-drag-drop") as IFileListDragDropEvent;
        const dataTransfer = e.dataTransfer;
        if (!dataTransfer) return;

        let dragTarget = null;
        switch (true) {
            case dataTransfer.files.length > 0 && enableDragFromOS: {
                const readFiles = new DragFilesReader().read(e);
                readFiles.then((files) => {
                    dragEvent.dragTarget = {
                        files,
                    };

                    if (file?.isDir) {
                        console.debug(
                            "Filelist/Tbody: upload 到 file 中",
                            file,
                        );
                        dragEvent.dropTarget = {
                            fileUri: file.uri,
                        };
                    } else {
                        //upload 到 file 所在目录
                        dragEvent.dropTarget = { fileUri };
                    }

                    if (dragEvent.dragTarget && dragEvent.dropTarget) {
                        onDrop?.(dragEvent);
                    }

                    this.setState({
                        dragFiles: null,
                        dropDir: null,
                    });
                    this._dragTarget = null;
                });
                return;
            }

            case this._dragTarget !== null:
                //在同一个host的文件视图中拖动，后续操作为移动文件
                dragTarget = this._dragTarget;
                if (file?.isDir) {
                    //如果拖放的目标的目录在拖动的文件列表中，则过滤掉这个目录
                    const index = dragTarget.files.indexOf(file);
                    if (index !== -1) {
                        dragTarget.files = dragTarget.files
                            .slice(0, index)
                            .concat(
                                dragTarget.files.slice(
                                    index + 1,
                                    dragTarget.files.length,
                                ),
                            );
                    }
                    //移动文件到该目录
                    if (dragTarget.files.length > 0) {
                        dragEvent.dragTarget = dragTarget;
                        dragEvent.dropTarget = {
                            fileUri: file.uri,
                        };
                    }
                }
                break;

            case dataTransfer.getData("drag-target") !== null:
                //在不同host的文件视图间拖动，后续操作为上传或下载
                dragTarget = e.dataTransfer.getData("drag-target");
                try {
                    dragTarget = JSON.parse(dragTarget);
                } catch (_e) {
                    dragTarget = null;
                }

                if (dragTarget) {
                    dragEvent.dragTarget = dragTarget;
                    if (file?.isDir) {
                        //upload or download 到 file 中
                        dragEvent.dropTarget = {
                            fileUri: file.uri,
                        };
                    } else {
                        //upload or download 到 file 所在目录
                        dragEvent.dropTarget = { fileUri };
                    }
                }
                break;
        }

        if (dragEvent.dragTarget && dragEvent.dropTarget) {
            onDrop?.(dragEvent);
        }

        this.setState({
            dragFiles: null,
            dropDir: null,
            lasterSelected: file,
        });
        this._dragTarget = null;
    }

    /**
     * 选中键盘上下箭头键指向的下一个文件项
     */
    selectNext(isUp: boolean) {
        let selected = this.state.selected;
        const last = selected[selected.length - 1];
        let next: IViewFileStat | undefined;
        const data = this.props.data;
        if (data.length === 0) {
            return;
        }
        const len = data.length - 1;
        if (!last) {
            next = data[isUp ? len : 0];
        } else {
            let lastIndex = data.indexOf(last);
            if (isUp) {
                next = data[Math.max(0, --lastIndex)];
            } else {
                next = data[Math.min(data.length - 1, ++lastIndex)];
            }
        }
        if (last !== next) {
            selected = [next];
            this.setState({ activeKey: next.uri, selected });
        }
    }

    /**
     * 按住SHIFT键用上下键连选
     */
    shiftSelectNext(isUp: boolean) {
        let selected = this.state.selected;
        const data = this.props.data;
        if (data.length === 0) {
            return;
        }
        const last = selected[selected.length - 1];
        let lastIndex = data.indexOf(last);
        let nextIndex = -1;
        if (lastIndex === -1) {
            return;
        }
        if (isUp) {
            nextIndex = --lastIndex;
            nextIndex = nextIndex >= 0 ? nextIndex : 0;
        } else {
            nextIndex = ++lastIndex;
            nextIndex =
                nextIndex <= data.length - 1 ? nextIndex : data.length - 1;
        }
        if (data[nextIndex] === selected[selected.length - 2]) {
            selected = selected.slice(0, selected.length - 1);
        } else {
            if (
                0 <= nextIndex &&
                nextIndex <= data.length - 1 &&
                data[nextIndex] !== selected[selected.length - 1]
            ) {
                // @ts-expect-error
                selected = [].concat(selected, data[nextIndex]);
            }
        }
        this.setState({
            activeKey: selected[selected.length - 1].uri,
            selected,
        });
    }

    clearSelected() {
        this.setState({ activeKey: null, selected: EMPTY_FILE_ARR });
    }

    /**
     * ctrl + a 全选
     */
    selectAll() {
        let selected = this.state.selected;
        const data = this.props.data;
        if (data.length === 0) {
            return;
        }
        // @ts-expect-error
        selected = [].concat(data);
        this.setState({ activeKey: null, selected });
    }

    /**
     * 选中与键盘输入的文件名匹配的文件项
     * 如果连续输入相同字母，则会在所有以该字母开头的文件中循环切换一个文件匹配
     * 连续输入不同的字母，则会匹配多字母，如输入'web', 则匹配第一个web开头的文件
     */
    selectByKeyword(keyword: string) {
        const data = this.props.data;
        if (data.length === 0) {
            return;
        }

        let selected: IViewFileStat[];
        let filterdData: IViewFileStat[];
        let index = 0;
        if (this._lastKeyword === keyword) {
            filterdData = this._lastFilteredCache || EMPTY_FILE_ARR;
            index = this._lastFilteredIndex + 1;
            if (index > filterdData.length - 1) {
                index = this._lastFilteredIndex = 0;
            } else {
                this._lastFilteredIndex = index;
            }
        } else {
            filterdData = data.filter(
                (item: { name: string }) =>
                    item.name.substr(0, keyword.length).toUpperCase() ===
                    keyword,
            );
            this._lastKeyword = keyword;
            this._lastFilteredCache = filterdData;
            index = this._lastFilteredIndex = 0;
        }

        if (filterdData[index]) {
            selected = [filterdData[index]];
            this.setState({
                activeKey: selected[0].uri,
                selected,
            });
        }
    }

    /**
     * 确保activeKey的文件项可见，如果不可见则滚动到可见
     */
    ensureActiveItemVisible(activeKey: string) {
        const { data, onActive } = this.props;
        if (!data) return;
        const activeIndex = data.findIndex((item) => item.uri === activeKey);
        console.debug(
            "Filelist/Tbody: ensureActiveItemVisible activeIndex ",
            activeIndex,
        );
        onActive?.(activeIndex);
    }

    /**
     * 手动高亮选中的文件，提升性能。
     */
    _highlightSelected(_nextProps: IProps, nextState: IState) {
        // console.debug("Filelist/Tbody: _highlightSelected");
        const {
            activeKey,
            selected,
            dragFiles,
            dropDir,
            lasterSelected,
            dropFileHover,
        } = this.state;
        const refs = this._refs;
        if (nextState.activeKey && activeKey !== nextState.activeKey) {
            this.ensureActiveItemVisible(nextState.activeKey);
        }

        if (selected !== nextState.selected) {
            selected.forEach((item: { uri: string | number }) => {
                const tr = refs[item.uri];
                if (tr) {
                    removeClass(tr, "filelistTableTrActive");
                    const checkbox = tr.querySelector(
                        'input[type="checkbox"]',
                    ) as HTMLInputElement | null;
                    if (checkbox) {
                        checkbox.checked = false;
                    }
                }
            });
        }

        nextState.selected.forEach((item: { uri: string | number }) => {
            const tr = refs[item.uri];
            if (tr) {
                addClass(tr, "filelistTableTrActive");
                const checkbox = tr.querySelector(
                    'input[type="checkbox"]',
                ) as HTMLInputElement | null;
                if (checkbox) {
                    checkbox.checked = true;
                }
            }
        });

        if (dragFiles !== nextState.dragFiles) {
            if (dragFiles) {
                dragFiles.forEach((item) => {
                    removeClass(refs[item.uri], "dragging");
                });
            }
            if (nextState.dragFiles) {
                nextState.dragFiles.forEach((item) => {
                    addClass(refs[item.uri], "dragging");
                });
            }
        }

        if (dropDir !== nextState.dropDir) {
            if (dropDir) {
                removeClass(refs[dropDir.uri], "filelistTableTrDragEnter");
            }
            if (nextState.dropDir) {
                addClass(
                    refs[nextState.dropDir.uri],
                    "filelistTableTrDragEnter",
                );
            }
        }

        if (dropFileHover !== nextState.dropFileHover) {
            if (dropFileHover) {
                removeClass(this._refs[dropFileHover], "hover");
            }
            if (nextState.dropFileHover) {
                addClass(this._refs[nextState.dropFileHover], "hover");
            }
        }

        lasterSelected &&
            removeClass(
                refs[lasterSelected.uri],
                "filelistTableTrActiveBorder",
            );
        nextState.lasterSelected &&
            addClass(
                refs[nextState.lasterSelected.uri],
                "filelistTableTrActiveBorder",
            );
    }

    // biome-ignore lint/suspicious/noExplicitAny: false
    _getTr(target: any): HTMLTableRowElement | null {
        let parent = target;
        while (parent) {
            if (parent === this.rootElRef.current) {
                parent = null;
                break;
            } else if (parent === document.body) {
                parent = null;
                break;
            }
            if (parent.nodeName === "TR") {
                break;
            }
            parent = parent.parentNode;
        }
        return parent;
    }

    _updateMouseSelection(endX: number, endY: number) {
        const el = document.getElementById(MOUSE_SELECTION_ELID);
        if (!el) {
            const el = document.createElement("div");
            el.id = MOUSE_SELECTION_ELID;
            el.style.position = "absolute";
            el.style.border = "1px solid #666";
            el.style.background = "rgba(0,0,0, 0.3)";
            // @ts-expect-error 类型定义错误
            el.style.zIndex = 9999;
            el.addEventListener("mousemove", (e) => {
                this.mouseMoveHandle(e);
            });
            el.addEventListener("mouseup", (e) => {
                this.mouseUpHandle(e);
            });
            document.body.appendChild(el);
        } else {
            el.style.display = "none";
            el.style.left = `${Math.min(this._startMouseDownX, endX)}px`;
            el.style.top = `${Math.min(this._startMouseDownY, endY)}px`;
            el.style.width = `${Math.abs(this._startMouseDownX - endX)}px`;
            el.style.height = `${Math.abs(this._startMouseDownY - endY)}px`;
            el.style.display = "block";
        }
    }

    _hideMouseSelection() {
        const el = document.getElementById(MOUSE_SELECTION_ELID);
        if (el) {
            el.style.display = "none";
        }
    }

    getMaxColsWidths() {
        const maxCols = this.getMaxCols();
        const colsWidth: Record<string, number> = {};
        const tbody = this.tbodyElRef.current;
        if (!tbody) {
            return colsWidth;
        }

        const trs = tbody.children;

        for (const key in maxCols) {
            const maxCol = maxCols[key];
            const rowIndex = maxCol.rowIndex;
            const colIndex = maxCol.colIndex;
            const tr = trs[rowIndex];
            if (!tr) break;
            const td = tr.children[colIndex] as HTMLTableCellElement;
            if (!td) break;

            /** 如果元素已经完整显示了，则判断是否有超出显示*/
            if (td.offsetWidth === td.scrollWidth) {
                colsWidth[key] = +(maxCol.columnWidth || td.offsetWidth);
            } else {
                /** scrollWidth跟实际站位宽度一致时会触发溢出隐藏，因此增加5px */
                colsWidth[key] = +td.scrollWidth + 5;
            }
        }

        return colsWidth;
    }

    /** 获取每列中length最长的td */
    getMaxCols() {
        const { columns, enableCheckbox } = this.props;
        const { data } = this.state;
        const maxCols: Record<
            string,
            {
                rowIndex: number;
                colIndex: number;
                value: string;
                length: number;
                columnWidth: number | undefined;
            }
        > = {};
        const displayColumns = columns.filter((item) => item.display === true);
        data.forEach((rowData, index: number) => {
            const rowIndex = index;
            displayColumns.forEach((column, colIndex: number) => {
                // eslint-disable-next-line no-param-reassign
                enableCheckbox && colIndex++;
                const itemKey = column.dataIndex as keyof IViewFileStat;
                const value = `${rowData[itemKey] as number | string}`;
                const length = value.length;
                if (!maxCols[itemKey]) {
                    maxCols[itemKey] = {
                        colIndex,
                        columnWidth: column.width,
                        length,
                        rowIndex,
                        value,
                    };
                } else if (maxCols[itemKey].length < length) {
                    maxCols[itemKey].rowIndex = rowIndex;
                    maxCols[itemKey].colIndex = colIndex;
                    maxCols[itemKey].value = value;
                    maxCols[itemKey].length = length;
                }
            });
        });
        return maxCols;
    }

    caculateData({
        data,
        layoutContainerHeight,
        scrollOffset,
        layoutRowHeight,
    }: {
        data: IViewFileStat[];
        layoutContainerHeight: number;
        scrollOffset: number;
        layoutRowHeight: number;
    }) {
        if (!layoutContainerHeight || !layoutRowHeight) {
            return null;
        }
        const renderDataLength =
            Math.ceil(layoutContainerHeight / layoutRowHeight) + 1;
        const startIndex = Math.floor(scrollOffset / layoutRowHeight);
        const endIndex = Math.min(data.length, startIndex + renderDataLength);
        const tbodyScrollOffset = startIndex * layoutRowHeight;
        const renderData = data.slice(startIndex, endIndex);

        if (
            Array.isArray(this._lastRenderData) &&
            this._lastRenderData.length === renderData.length &&
            this._lastRenderData.every((item, i) => item === renderData[i])
        ) {
            console.debug("Filelist/Tbody: caculateData renderData no change");
            return null;
        }

        console.debug(
            "Filelist/Tbody: caculateData ",
            `renderDataLength=${renderDataLength}, startIndex=${startIndex}, endIndex=${endIndex}, tbodyScrollOffset=${tbodyScrollOffset}`,
        );

        this._lastRenderData = renderData;
        this._startRenderDataIndex = startIndex;
        return {
            data: renderData,
            tbodyScrollOffset,
        };
    }
}
