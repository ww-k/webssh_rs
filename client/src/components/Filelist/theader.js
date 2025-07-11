import { CaretDownOutlined, CaretUpOutlined } from "@ant-design/icons";
import throttle from "lodash/throttle";
import { Component } from "react";

import ResizeLine from "../ResizeLine";

class Theader extends Component {
    constructor(props) {
        super(props);

        this.isClick = true;
        this.sortDirections = ["ascend", "descend"];

        this.state = {
            selectAll: false,
            sortBy: props.defaultSortBy,
            ascend: props.defaultSortOrder === "ascend" || true,
        };

        this.tableColResizeHandle = throttle(
            this.tableColResizeHandle.bind(this),
            50,
        );
    }

    render() {
        const {
            columns,
            tableWidth,
            enableCheckbox,
            colCheckboxWidth,
            onContextMenu,
        } = this.props;
        const state = this.state;

        return (
            <div className="table-header-wrapper" style={{ width: tableWidth }}>
                <table
                    className="table table-header"
                    style={{ width: tableWidth }}
                    onContextMenu={onContextMenu}
                >
                    <thead>
                        <tr>
                            {enableCheckbox && (
                                <th
                                    className="col-checkbox"
                                    style={{ width: colCheckboxWidth }}
                                >
                                    <input
                                        type="checkbox"
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
                                        key={
                                            column.sortKey ||
                                            column.dataIndex ||
                                            i
                                        }
                                        className={column.className}
                                        style={{ width: column.width || 0 }}
                                        onClick={this.thClickHandle.bind(
                                            this,
                                            column,
                                        )}
                                    >
                                        <div className="table-column-sorters">
                                            <span
                                                className="table-column-title"
                                                style={{
                                                    textAlign:
                                                        column.headerAlign ||
                                                        "left",
                                                }}
                                            >
                                                {column.title}
                                            </span>
                                            <span className="table-column-sorter">
                                                <CaretUpOutlined
                                                    className={
                                                        state.sortBy ===
                                                            (column.sortKey ||
                                                                column.dataIndex) &&
                                                        state.ascend
                                                            ? "active"
                                                            : ""
                                                    }
                                                />
                                                <CaretDownOutlined
                                                    className={
                                                        state.sortBy ===
                                                            (column.sortKey ||
                                                                column.dataIndex) &&
                                                        !state.ascend
                                                            ? "active"
                                                            : ""
                                                    }
                                                />
                                            </span>
                                        </div>
                                        <div className="border-right" />
                                        <ResizeLine
                                            className="resize-line-filelist"
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

    thClickHandle(column, e) {
        e.stopPropagation();
        const key = column.sortKey || column.dataIndex;
        if (this.isClick) {
            const state = this.state;
            const onThClick = this.props.onThClick;
            const ascend = state.sortBy === key ? !state.ascend : state.ascend;
            this.setState({
                sortBy: key,
                ascend,
            });

            onThClick?.(key, ascend);
        } else {
            this.isClick = true;
        }
    }

    tableColResizeHandle(column, e) {
        if (!this._tmpOriginWidth) {
            this._tmpOriginWidth = column.width;
        }
        const newWidth = this._tmpOriginWidth + e.moveX;
        if (!Number.isNaN(newWidth)) {
            column.width = newWidth;

            const { tableColResizeHandle } = this.props;
            tableColResizeHandle?.(column);
        }
    }

    tableColResizeDoneHandle(_column) {
        this.isClick = false;
        this._tmpOriginWidth = null;
    }

    checkboxClickHandle(e) {
        this.setState({
            selectAll: e.target.checked,
        });
        const { onCheckChange } = this.props;
        onCheckChange?.(e.target.checked);
    }

    clearSelectAll() {
        if (this.state.selectAll) {
            this.setState({
                selectAll: false,
            });
        }
    }
}

Theader.defaultProps = {
    enableCheckbox: true,
    onThClick: null,
    onCheckChange: null,
};

export default Theader;
