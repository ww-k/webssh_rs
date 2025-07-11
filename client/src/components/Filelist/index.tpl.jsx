import { Spin } from "antd";
import classNames from "classnames";
import "./index.less";

import Tbody from "./tbody";
import Theader from "./theader";

export default function render() {
    const {
        i18n: I18N_TXT,
        className,
        columns,
        host,
        fileUrl,
        loading,
        draggable,
        emptyContent,
        tabIndex,
        itemHeight,
    } = this.props;
    const {
        defaultSortBy,
        defaultSortOrder,
        data,
        activeKey,
        selected,
        disabled,
        colCheckboxWidth,
        tableWidth,
        containerWidth,
        containerHeight,
        scrollOffset,
    } = this.state;
    const rootCls = classNames({
        filelistRootCls: true,
        [className]: true,
        loading,
    });
    const loadLayerCls = classNames({
        "load-layer": loading,
        hide: !loading,
    });
    return (
        <div
            tabIndex={tabIndex}
            className={rootCls}
            onScroll={this.scrollHandle.bind(this)}
            onMouseDown={this.rootMouseDownHandle.bind(this)}
            onKeyDown={this.rootKeyDownHandle.bind(this)}
            onContextMenu={this.contextMenuHandle.bind(this, null)}
            ref={this.rootElRef}
        >
            <Theader
                ref={this.listTheaderRef}
                columns={columns}
                i18n={I18N_TXT}
                tableWidth={tableWidth}
                defaultSortBy={defaultSortBy}
                defaultSortOrder={defaultSortOrder}
                colCheckboxWidth={colCheckboxWidth}
                tableColResizeHandle={this.tableColResizeHandle.bind(this)}
                onThClick={this.handleSort.bind(this)}
                onCheckChange={this.handleCheckAllChange.bind(this)}
                onContextMenu={this.handleHeaderContextMenu.bind(this)}
            />
            {emptyContent ? (
                typeof emptyContent === "function" ? (
                    emptyContent()
                ) : (
                    <div className="request-error">{emptyContent}</div>
                )
            ) : (
                <Tbody
                    ref={this.listTbodyRef}
                    tableWidth={tableWidth}
                    containerWidth={containerWidth}
                    containerHeight={containerHeight}
                    scrollOffset={scrollOffset}
                    itemHeight={itemHeight}
                    columns={columns}
                    data={data}
                    host={host}
                    fileUrl={fileUrl}
                    parentFile={this.parentFile}
                    colCheckboxWidth={colCheckboxWidth}
                    activeKey={activeKey}
                    selected={selected}
                    disabled={disabled}
                    draggable={draggable}
                    onActive={this.ensureActiveItemVisible.bind(this)}
                    onSelected={this.filesSelectedChange.bind(this)}
                    onFileClick={this.fileClickHandle.bind(this)}
                    onFileDoubleClick={this.fileDoubleClickHandle.bind(this)}
                    onContextMenu={this.contextMenuHandle.bind(this)}
                    onDrop={this.filesDropHandle.bind(this)}
                />
            )}
            <div className={loadLayerCls}>
                <Spin />
            </div>
        </div>
    );
}
