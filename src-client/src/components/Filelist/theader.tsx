import { CaretDownOutlined, CaretUpOutlined } from "@ant-design/icons";
import throttle from "lodash/throttle";
import { Component, createRef } from "react";

import ResizeLine from "../ResizeLine";

import type { IFileListColumn } from "./types";

interface IProps {
    columns: IFileListColumn[];
    enableCheckbox?: boolean;
    layoutTableWidth: number;
    layoutColCheckboxWidth: number;
    sortByDefault: string;
    sortOrderDefault: "ascend" | "descend";
    onSort?: (key: string, ascend: boolean) => void;
    onCheckChange?: (checked: boolean) => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    onColResize?: (column: IFileListColumn) => void;
    onColResizeDone?: (column: IFileListColumn) => void;
}

interface IState {
    selectAll: boolean;
    sortBy: string;
    ascend: boolean;
}

export default class Theader extends Component<IProps, IState> {
    static defaultProps = {
        enableCheckbox: true,
    };
    isClick: boolean = true;
    _tmpOriginWidth?: number | null;
    rootElRef: React.RefObject<HTMLDivElement> = createRef();
    constructor(props: IProps) {
        super(props);

        this.state = {
            ascend: props.sortOrderDefault === "ascend" || true,
            selectAll: false,
            sortBy: props.sortByDefault,
        };

        this.tableColResizeHandle = throttle(
            this.tableColResizeHandle.bind(this),
            50,
        );
    }

    render() {
        const {
            columns,
            enableCheckbox,
            layoutTableWidth,
            layoutColCheckboxWidth,
            onContextMenu,
        } = this.props;
        const state = this.state;

        return (
            <div
                ref={this.rootElRef}
                className="filelistTableHeaderWrapper"
                style={{ width: layoutTableWidth }}
            >
                <table
                    className="filelistTable filelistTableHeader"
                    style={{ width: layoutTableWidth }}
                    onContextMenu={onContextMenu}
                >
                    <thead>
                        <tr>
                            {enableCheckbox && (
                                <th
                                    className="filelistTableCellColCheckbox"
                                    style={{ width: layoutColCheckboxWidth }}
                                >
                                    <input
                                        type="checkbox"
                                        name="filelistTHeaderCheckbox"
                                        checked={state.selectAll}
                                        onChange={this.checkboxClickHandle.bind(
                                            this,
                                        )}
                                    />
                                </th>
                            )}
                            {columns.map((column, i) =>
                                column.display ? (
                                    <th
                                        className={column.className}
                                        style={{ width: column.width || 0 }}
                                        key={
                                            column.sortKey ||
                                            column.dataIndex ||
                                            i
                                        }
                                        onClick={this.thClickHandle.bind(
                                            this,
                                            column,
                                        )}
                                    >
                                        <div className="filelistTableColumnHeader">
                                            <span className="filelistTableColumnTitle">
                                                {column.title}
                                            </span>
                                            <span className="filelistTableColumnSorter">
                                                <CaretUpOutlined
                                                    className={
                                                        state.sortBy ===
                                                            (column.sortKey ||
                                                                column.dataIndex) &&
                                                        state.ascend
                                                            ? "filelistTableColumnSorterIconActive"
                                                            : ""
                                                    }
                                                />
                                                <CaretDownOutlined
                                                    className={
                                                        state.sortBy ===
                                                            (column.sortKey ||
                                                                column.dataIndex) &&
                                                        !state.ascend
                                                            ? "filelistTableColumnSorterIconActive"
                                                            : ""
                                                    }
                                                />
                                            </span>
                                        </div>
                                        <div className="filelistTableThBorderRight" />
                                        <ResizeLine
                                            className="filelistResizeLine"
                                            onMove={this.tableColResizeHandle.bind(
                                                this,
                                                column,
                                            )}
                                            onMoved={this.tableColResizeDoneHandle.bind(
                                                this,
                                                column,
                                            )}
                                        />
                                    </th>
                                ) : null,
                            )}
                        </tr>
                    </thead>
                </table>
            </div>
        );
    }

    thClickHandle(column: IFileListColumn, evt: React.MouseEvent) {
        evt.stopPropagation();
        const key = column.sortKey || column.dataIndex;
        if (this.isClick) {
            const state = this.state;
            const ascend = state.sortBy === key ? !state.ascend : state.ascend;
            this.setState({
                ascend,
                sortBy: key,
            });

            this.props.onSort?.(key, ascend);
        } else {
            this.isClick = true;
        }
    }

    tableColResizeHandle(
        column: IFileListColumn,
        evt: { moveX: number; moveY: number },
    ) {
        if (!this._tmpOriginWidth) {
            this._tmpOriginWidth = column.width;
        }
        if (!this._tmpOriginWidth) return;
        const newWidth = this._tmpOriginWidth + evt.moveX;
        if (!Number.isNaN(newWidth)) {
            column.width = newWidth;
            this.props.onColResize?.(column);
        }
    }

    tableColResizeDoneHandle(column: IFileListColumn) {
        this.isClick = false;
        this._tmpOriginWidth = null;
        this.props.onColResizeDone?.(column);
    }

    checkboxClickHandle(evt: React.ChangeEvent<HTMLInputElement>) {
        this.setState({
            selectAll: evt.target.checked,
        });
        const { onCheckChange } = this.props;
        onCheckChange?.(evt.target.checked);
    }

    unselectAll() {
        if (this.state.selectAll) {
            this.setState({
                selectAll: false,
            });
        }
    }

    getRootDom() {
        return this.rootElRef.current;
    }
}
