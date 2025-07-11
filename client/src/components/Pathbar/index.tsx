import {
    CloseCircleFilled,
    DesktopOutlined,
    DoubleLeftOutlined,
    DownloadOutlined,
    DownOutlined,
    FileTextOutlined,
    FolderTwoTone,
    HomeOutlined,
    LaptopOutlined,
    ReloadOutlined,
    SearchOutlined,
} from "@ant-design/icons";
import { Spin } from "antd";
import classNames from "classnames";
import throttle from "lodash/throttle";
import { Component, createRef } from "react";

import path, { posix as pathPosix } from "@/helpers/path";
import i18n from "@/i18n";

import "./index.less";

import { buildSearchUri, isSearchUri, parseSearchUri } from "./search";

import type { DebouncedFuncLeading } from "lodash";
import type { IFile } from "@/types";

interface IRouteItem {
    name: string;
    title: string;
    path: string;
    link: boolean;
}

interface IQuickLink {
    name: string;
    path: string;
}

interface IProps {
    className?: string;
    data: string;
    /** 是否是posix风格路径 */
    posix?: boolean;
    enableHomeIcon?: boolean;
    /** 是否允许用户交互点击路径栏，显示下拉目录等 */
    enableReact?: boolean;
    /** 是否允许手动输入路径 */
    enableInput?: boolean;
    /** 是否允许搜索 */
    enableSearch?: boolean;
    history: string[];
    getDirs?: (fileUrlOrPath: string) => Promise<IFile[]>;
    getQuickLinks?: () => Promise<IQuickLink[]>;
    onChange?: (newPath: string) => void;
}

interface IState {
    /** 访问过的路径历史记录下拉框是否打开 */
    historyOpen: boolean;
    /** 编辑模式下，文本框中的值 */
    editorValue: string;
    /** 路径原始值格式化后的数据 */
    routes: IRouteItem[];
    history: IQuickLink[];
    /** 是否聚焦, 聚焦后, 进入编辑模式, 显示路径的原始值, 可直接输入路径 */
    isFocus: boolean;
    /** 快速链接下拉框是否显示 */
    quickLinksVisible: boolean;
    /** 本机视图快速链接 */
    quickLinks: IQuickLink[];
    /** 隐藏的路径, 路径长度超出路径栏时，超出可视区域前面部分会收到快速链接下拉框里 */
    hiddenRoutes: IRouteItem[];
    /** 是否已激活快速预览子目录模式 */
    previewModeActived: boolean;
    /** 快速预览子目录模式下, 激活的路径项索引 */
    activedIndex: number | null;
    /** 快速预览子目录模式下, 激活的路径项的路径 */
    activedPath: string;
    /** 快速预览子目录模式下, 显示的目录列表 */
    dirList: IFile[];
    /** 快速预览子目录模式下, 显示的目录列表距离路径栏左边的距离 */
    dirListLeft: number | null;
    /** 快速预览子目录模式下, 显示的目录列表加载状态 */
    dirListLoading: boolean;
    /** 快速预览子目录模式下, 显示的目录列表加载失败时的错误信息 */
    dirListLoadingMsg: string;
    /** breadcrumb dom的left样式属性 */
    breadcrumbLeft: number;
    /** 搜索文本框中的值 */
    searchValue: string;
}

export default class Pathbar extends Component<IProps, IState> {
    /** nodejs path 模块 */
    path: typeof path;
    /** 快速预览子目录模式下, 显示的目录列表的缓存 */
    dirListCache: Record<string, IFile[]>;
    resizeViewThrottle: DebouncedFuncLeading<() => void>;
    rootElRef: React.RefObject<HTMLDivElement>;
    breadcrumbBoxRef: React.RefObject<HTMLDivElement>;
    breadcrumbRef: React.RefObject<HTMLDivElement>;
    routeItemRefsMap: Record<string, HTMLSpanElement | null>;
    _resizeObserver!: ResizeObserver;

    static defaultProps = {
        className: "",
        data: "",
        history: [],
        quickLinks: [],
        enableHomeIcon: true,
        enableReact: true,
        enableInput: true,
        enableSearch: false,
        onChange: null,
    };

    constructor(props: IProps) {
        super(props);

        this.path = props.posix ? pathPosix : path;
        const routes = this.generateRoutes(props.data);
        const editorValue = this.generateEditorValue(props.data);
        const history = this.generateHisotory(props.history);

        this.state = {
            historyOpen: false,
            editorValue,
            routes,
            history,
            isFocus: false,
            breadcrumbLeft: 5,
            quickLinksVisible: false,
            quickLinks: [],
            hiddenRoutes: [],
            previewModeActived: false,
            activedIndex: null,
            activedPath: "",
            dirList: [],
            dirListLeft: null,
            dirListLoading: false,
            dirListLoadingMsg: "",
            searchValue: parseSearchUri(props.data).searchValue,
        };
        this.dirListCache = {};

        this.resizeViewThrottle = throttle(() => this.resizeView(), 200);
        this.handleClickOutside = this.handleClickOutside.bind(this);

        this.rootElRef = createRef<HTMLDivElement>();
        this.breadcrumbBoxRef = createRef<HTMLDivElement>();
        this.breadcrumbRef = createRef<HTMLDivElement>();
        this.routeItemRefsMap = {};
    }

    componentDidMount() {
        if (!this.rootElRef.current) return;
        this.resizeViewThrottle();
        this.getQuickLinks();

        this._resizeObserver = new ResizeObserver((_entries, observer) => {
            const rootEl = this.rootElRef.current;
            if (!rootEl) {
                observer.disconnect();
                return;
            }
            this.resizeViewThrottle();
        });
        this._resizeObserver.observe(this.rootElRef.current);
        document.addEventListener("click", this.handleClickOutside);
    }

    componentDidUpdate(preProps: IProps) {
        const { data, history: curHistory } = this.props;
        if (preProps.data !== data || preProps.history !== curHistory) {
            //TODO: 变化触发不及时，当路径是过程目录时，没有及时更新界面
            const routes = this.generateRoutes(data);
            const history = this.generateHisotory(curHistory);
            const newState = {
                routes,
                history,
                editorValue: this.state.editorValue,
                searchValue: parseSearchUri(data).searchValue,
            };
            if (!this.state.isFocus) {
                newState.editorValue = this.generateEditorValue(data);
            }
            this.setState(newState, () => this.resizeViewThrottle());
        }
    }

    componentWillUnmount() {
        this._resizeObserver.disconnect();
        this._resizeObserver = null as unknown as ResizeObserver;
        document.removeEventListener("click", this.handleClickOutside);
    }

    render() {
        const { className, enableHomeIcon, enableReact, enableSearch } =
            this.props;
        const {
            historyOpen,
            editorValue,
            searchValue,
            routes,
            history,
            isFocus,
            breadcrumbLeft,
            quickLinksVisible,
            quickLinks,
            hiddenRoutes,
            activedIndex,
            dirList,
            dirListLeft,
            previewModeActived,
            activedPath,
            dirListLoading,
            dirListLoadingMsg,
        } = this.state;
        const rootCls = classNames({
            pathbar: true,
            [className || ""]: className !== undefined,
        });
        const inputGroupCls = classNames({
            pathbarInputGroup: true,
            open: historyOpen,
        });

        return (
            <div
                ref={this.rootElRef}
                className={rootCls}
                onClick={this.handleClickOutside.bind(this)}
            >
                {enableHomeIcon || hiddenRoutes.length > 0 ? (
                    <div className="pathbarHomeBox">
                        <button
                            className={classNames({
                                "btn dropdown-btn home-btn": true,
                                hover: quickLinksVisible,
                            })}
                            onClick={this.btnHomeClickHandle.bind(this)}
                        >
                            {!quickLinksVisible ? (
                                breadcrumbLeft < 5 ? (
                                    <DoubleLeftOutlined />
                                ) : (
                                    <HomeOutlined />
                                )
                            ) : (
                                <DownOutlined />
                            )}
                        </button>
                        <ul
                            className="pathbarDropdownMenu pathbarDropdownMenuDirMenu"
                            style={{
                                display: quickLinksVisible ? "block" : "none",
                            }}
                        >
                            {hiddenRoutes.map((item) => (
                                <li
                                    key={item.path}
                                    onClick={this.handleClickHiddenRoute.bind(
                                        this,
                                        item,
                                    )}
                                >
                                    <div>
                                        <FolderTwoTone />
                                        <span>{item.name}</span>
                                    </div>
                                </li>
                            ))}
                            {quickLinks.length > 0 && (
                                <li>
                                    <ul className="pathbarDropdownMenuQuickLinsMenu">
                                        {quickLinks.map((item) => {
                                            const name =
                                                i18n.t(
                                                    `pathbar_home_path_${item.name}`,
                                                ) || item.name;
                                            let icon = <FolderTwoTone />;
                                            switch (item.name) {
                                                case "/":
                                                    icon = <LaptopOutlined />;
                                                    break;
                                                case "Home":
                                                    icon = <HomeOutlined />;
                                                    break;
                                                case "Desktop":
                                                    icon = <DesktopOutlined />;
                                                    break;
                                                case "Documents":
                                                    icon = <FileTextOutlined />;
                                                    break;
                                                case "Downloads":
                                                    icon = <DownloadOutlined />;
                                            }

                                            return (
                                                <li key={item.path}>
                                                    <div
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            this.btnHomeItemClickHandle(
                                                                item.path,
                                                            );
                                                        }}
                                                    >
                                                        {icon}
                                                        {name}
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </li>
                            )}
                        </ul>
                    </div>
                ) : null}
                {previewModeActived && (
                    <div>
                        <ul
                            className="pathbarDropdownMenu pathbarDropdownMenuDirMenu"
                            style={{
                                display: "block",
                                left:
                                    dirListLeft !== null && dirListLeft < 0
                                        ? "0px"
                                        : `${dirListLeft !== null ? dirListLeft : 0}px`,
                            }}
                        >
                            {dirListLoading || dirListLoadingMsg ? (
                                <li>
                                    <div className="remote-loading-msg">
                                        {dirListLoadingMsg ? (
                                            <span>{dirListLoadingMsg}</span>
                                        ) : (
                                            <Spin />
                                        )}
                                    </div>
                                </li>
                            ) : (
                                dirList.map((item) => (
                                    <li
                                        key={item.url}
                                        onClick={this.handleClickDir.bind(
                                            this,
                                            item,
                                        )}
                                    >
                                        <div
                                            className={classNames({
                                                "selected-dir":
                                                    item.url === activedPath,
                                            })}
                                        >
                                            <FolderTwoTone />
                                            <span>{item.name}</span>
                                        </div>
                                    </li>
                                ))
                            )}
                        </ul>
                    </div>
                )}
                <div className={inputGroupCls}>
                    <div className="input-content">
                        {isFocus ? (
                            <div className="form-control editorWrapper">
                                <input
                                    autoFocus={true}
                                    type="text"
                                    name="pathbarEditorInput"
                                    className="pathbarEditorInput"
                                    value={editorValue}
                                    onChange={this.editorChangeHandle.bind(
                                        this,
                                    )}
                                    onKeyDown={this.editorKeyDownHandle.bind(
                                        this,
                                    )}
                                    onBlur={this.editorBlurHandle.bind(this)}
                                />
                            </div>
                        ) : (
                            <div
                                className="form-control breadcrumbBox"
                                ref={this.breadcrumbBoxRef}
                                onClick={this.editorFocusHandle.bind(this)}
                            >
                                <div
                                    className={classNames({
                                        "ant-breadcrumb limit": true,
                                        "ant-breadcrumb-disable": !enableReact,
                                    })}
                                    ref={this.breadcrumbRef}
                                    style={{ left: `${breadcrumbLeft}px` }}
                                >
                                    {routes.map((route, i, arr) => (
                                        <span
                                            key={route.path}
                                            ref={(el) => {
                                                this.routeItemRefsMap[
                                                    `link${i}`
                                                ] = el;
                                            }}
                                            className={classNames({
                                                span: true,
                                                "select-span":
                                                    activedIndex === i,
                                            })}
                                            onMouseOver={this.handleMouseOver.bind(
                                                this,
                                                route,
                                                i,
                                            )}
                                            title={route.title}
                                        >
                                            <span className="ant-breadcrumb-link">
                                                {route.link ? (
                                                    <span
                                                        className="link-color"
                                                        onClick={this.clickPathHandle.bind(
                                                            this,
                                                            route,
                                                        )}
                                                    >
                                                        {route.name}
                                                    </span>
                                                ) : (
                                                    route.name
                                                )}
                                            </span>
                                            {i < arr.length - 1 && (
                                                <span
                                                    onClick={this.handleSelectDirList.bind(
                                                        this,
                                                        route,
                                                        i,
                                                    )}
                                                    className={classNames({
                                                        "ant-breadcrumb-separator": true,
                                                    })}
                                                >
                                                    <span
                                                        className={classNames({
                                                            "arrow-down":
                                                                activedIndex ===
                                                                i,
                                                        })}
                                                    >
                                                        &gt;
                                                    </span>
                                                </span>
                                            )}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                        <button
                            className={classNames({
                                "btn dropdown-btn history-btn": true,
                                hover: historyOpen,
                            })}
                            onClick={this.btnHistoryClickHandle.bind(this)}
                        >
                            <DownOutlined />
                        </button>
                    </div>
                    <ul className="pathbarDropdownMenu">
                        {history.map((item) => (
                            <li key={item.path}>
                                <div
                                    key={item.path}
                                    className="link-color"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        this.historyItemClickHandle(item.path);
                                    }}
                                >
                                    {item.name}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
                <button
                    className={`button ${enableSearch ? "" : "last-btn"}`}
                    type="button"
                    onClick={this.btnRefreshClickHandle.bind(this)}
                >
                    <ReloadOutlined />
                </button>
                {enableSearch && (
                    <div className="pathbarInputSearch">
                        <input
                            type="text"
                            name="pathbarSearchInput"
                            onChange={this.inputSearchChangeHandle.bind(this)}
                            onKeyDown={this.inputSearchKeyDownHandle.bind(this)}
                            value={searchValue}
                        />
                        {searchValue && (
                            <span
                                className="pathbarInputSearchClear"
                                onClick={this.btnClearSearchClickHandle.bind(
                                    this,
                                )}
                            >
                                <CloseCircleFilled />
                            </span>
                        )}
                        <button
                            className={"button last-btn"}
                            onClick={this.btnSearchClickHandle.bind(this)}
                        >
                            <SearchOutlined />
                        </button>
                    </div>
                )}
            </div>
        );
    }

    resizeView() {
        if (this.breadcrumbBoxRef.current && this.breadcrumbRef.current) {
            const breadcrumbBoxWidth =
                this.breadcrumbBoxRef.current.getBoundingClientRect().width;
            const breadcrumbWidth =
                this.breadcrumbRef.current.getBoundingClientRect().width;
            if (breadcrumbBoxWidth === 0 || breadcrumbWidth === 0) {
                this.setState({
                    breadcrumbLeft: this.state.breadcrumbLeft,
                });
                return;
            }
            let breadcrumbLeft: number;
            if (breadcrumbBoxWidth - breadcrumbWidth < 50) {
                const len = this.state.routes.length - 1;
                let visible = 0;
                for (let i = len; i > 0; i--) {
                    const currentSpan = this.routeItemRefsMap[`link${i}`];
                    if (!currentSpan) return;
                    const currentWidth =
                        currentSpan.getBoundingClientRect().width;
                    if (visible + currentWidth < breadcrumbBoxWidth) {
                        visible += currentWidth;
                    } else {
                        // 路径栏宽度只够显示最后一个子路径时，溢出隐藏省略号展示
                        if (i === len) {
                            visible += currentWidth;
                            const firstChild = currentSpan
                                .children[0] as HTMLSpanElement;
                            if (firstChild) {
                                firstChild.style.whiteSpace = "nowrap";
                                firstChild.style.overflow = "hidden";
                                firstChild.style.textOverflow = "ellipsis";
                                firstChild.style.width = `${breadcrumbBoxWidth}px`;
                                firstChild.style.display = "inline-block";
                            }
                        }
                        break;
                    }
                }
                breadcrumbLeft = -(breadcrumbWidth - visible);
            } else {
                breadcrumbLeft = 5;
            }
            this.setState({ breadcrumbLeft });
            this.getHiddenLink(breadcrumbLeft);
        }
    }

    handleSelectDirList(route: IRouteItem, i: number, e: React.MouseEvent) {
        e.stopPropagation();
        if (!this.props.enableReact || !route.link) {
            return;
        }
        const { activedIndex, previewModeActived } = this.state;

        // 关闭列表
        if (activedIndex === i) {
            this.setState({
                dirList: [],
                activedIndex: null,
                quickLinksVisible: false,
                dirListLoading: false,
                dirListLoadingMsg: "",
                previewModeActived: !previewModeActived,
            });
            return;
        }

        /**
         * 点击行为的交互效果
         */
        const newState = {
            previewModeActived: !previewModeActived,
            quickLinksVisible: false,
        };
        this.getFileList(i, newState).then((list) => {
            if (i !== this.state.activedIndex) return;
            this.setState({
                dirList: list,
                dirListLoading: false,
                dirListLoadingMsg: "",
            });
        });
    }

    handleMouseOver(route: IRouteItem, i: number, e: React.MouseEvent) {
        e.stopPropagation();
        e.preventDefault();
        if (!route.link) {
            return;
        }

        const { routes, previewModeActived, activedIndex } = this.state;
        if (
            previewModeActived === false ||
            i === routes.length - 1 ||
            activedIndex === i
        ) {
            return false;
        }

        this.getFileList(i).then((list) => {
            if (i !== this.state.activedIndex) return;
            this.setState({
                dirList: list || [],
                dirListLoading: false,
                dirListLoadingMsg: "",
            });
        });
    }

    // 获取文件列表
    getFileList(i: number, newState = {}) {
        const { getDirs } = this.props;
        if (!getDirs) return Promise.reject("getDirs is not a function");

        const { routes, breadcrumbLeft } = this.state;
        const path = routes[i].path;
        const link0 = this.routeItemRefsMap.link0;
        const link_i = this.routeItemRefsMap[`link${i}`];
        if (!link0 || !link_i) {
            return Promise.reject("link0 or link_i is null");
        }

        const newDirListLeft =
            link_i.getBoundingClientRect().left -
            link0.getBoundingClientRect().left;
        const objKey = path;

        /**
         * 数据获取
         * 优先读取缓存, 缓存中没有数据时开启加载动画
         */
        if (this.dirListCache[objKey]) {
            this.setState(
                Object.assign(
                    {
                        dirList: this.dirListCache[objKey],
                        activedIndex: i,
                        dirListLoading: false,
                        dirListLoadingMsg: "",
                        activedPath: routes[i + 1].path,
                        dirListLeft:
                            breadcrumbLeft < 0
                                ? newDirListLeft + breadcrumbLeft
                                : newDirListLeft,
                    },
                    newState,
                ),
            );
        } else {
            this.setState(
                Object.assign(
                    {
                        dirList: [],
                        dirListLoading: true,
                        dirListLoadingMsg: "",
                        activedIndex: i,
                        dirListLeft:
                            breadcrumbLeft < 0
                                ? newDirListLeft + breadcrumbLeft
                                : newDirListLeft,
                        activedPath: routes[i + 1].path,
                    },
                    newState,
                ),
            );
        }

        return new Promise<IFile[]>((resolve, reject) => {
            getDirs(path)
                .then((response) => {
                    const newDirList: IFile[] = [];
                    response.forEach((item) => {
                        if (item.type === "d") {
                            newDirList.push(item);
                        }
                    });
                    // 临时缓存数据
                    this.dirListCache[objKey] = newDirList;
                    return resolve(newDirList);
                })
                .catch((err) => {
                    this.setState({
                        dirListLoading: false,
                        dirListLoadingMsg: err.msg,
                    });
                    return reject(err);
                });
        });
    }

    //用于计算那几个路径被隐藏
    getHiddenLink(breadcrumbLeft?: number) {
        if (breadcrumbLeft === undefined) {
            breadcrumbLeft = this.state.breadcrumbLeft;
        }
        if (breadcrumbLeft >= 5) {
            if (this.state.hiddenRoutes.length > 0) {
                this.setState({
                    hiddenRoutes: [],
                });
            }
            return;
        }
        let hiddenRoutes = [];
        let total = 0;
        const { routes } = this.state;
        for (let i = 0; i < routes.length; i++) {
            const dom = this.routeItemRefsMap[`link${i}`];
            if (!dom) return;
            const link = dom.getBoundingClientRect().width;
            total += link;
            if (total < -Number(breadcrumbLeft) + 25) {
                hiddenRoutes.push(routes[i]);
            }
        }
        hiddenRoutes = hiddenRoutes.reverse();
        this.setState({
            hiddenRoutes,
        });
    }

    handleClickHiddenRoute(route: IRouteItem) {
        const { activedPath } = this.state;
        if (route.path === activedPath) {
            return;
        }

        this.props.onChange?.(route.path);
    }

    handleClickDir(dir: IFile) {
        if (dir.url === this.state.activedPath) {
            return;
        }

        this.props.onChange?.(dir.url);
    }

    getQuickLinks() {
        this.props.getQuickLinks?.().then((list) => {
            this.setState({ quickLinks: list });
        });
    }

    generateRoutes(data: string) {
        if (isSearchUri(data)) {
            return [
                {
                    name: this.generateSearchDisplay(data),
                    title: "",
                    path: data,
                    link: false,
                },
            ];
        }

        const sep = this.path.sep;
        const routes: IRouteItem[] = [];
        const arr = data === sep ? [] : data.split(sep);
        let fullpath = "";
        let title = "";
        if (arr[0] && arr[0].substring(0, 4) === "prn:") {
            fullpath = arr[0];
            arr[0] = "";
        }
        routes.push({
            name: "/",
            title: "/",
            path: `${fullpath}/`,
            link: true,
        });

        if (arr[0] === "") {
            arr.shift();
        }
        if (arr[arr.length - 1] === "") {
            //去掉最后一项空字符串, 拼接路径时, 最后不带分隔符
            arr.pop();
        }

        arr.forEach((dirname, i) => {
            if (dirname !== "") {
                if (i === 0 && sep === "\\") {
                    fullpath = dirname;
                    title = dirname;
                } else {
                    fullpath += sep + dirname;
                    title += sep + dirname;
                }
                routes.push({
                    name: dirname,
                    title,
                    path: fullpath,
                    link: true,
                });
            }
        });

        // 最后一项显示为非链接状态
        routes[routes.length - 1].link = false;
        return routes;
    }

    generateEditorValue(data: string) {
        return this.getFileFullpath(data);
    }

    generateHisotory(data: string[]) {
        return data.map((item) => {
            const name = item;

            if (isSearchUri(item)) {
                return {
                    name: this.generateSearchDisplay(item),
                    path: item,
                };
            }

            return {
                name,
                path: item,
            };
        });
    }

    editorFocusHandle() {
        this.setState({ isFocus: true });
    }

    editorBlurHandle() {
        const editorValue = this.generateEditorValue(this.props.data);
        this.setState({
            editorValue,
            isFocus: false,
        });
    }

    clickPathHandle(route: IRouteItem, e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (!this.props.enableReact || !route.link) {
            return;
        }

        this.props.onChange?.(route.path);
        this.setState({
            activedIndex: null,
            previewModeActived: false,
        });
    }

    editorChangeHandle(evt: React.ChangeEvent<HTMLInputElement>) {
        if (!this.props.enableInput) {
            evt.preventDefault();
            return;
        }
        this.setState({
            editorValue: evt.target.value,
        });
    }

    editorKeyDownHandle(evt: React.KeyboardEvent<HTMLInputElement>) {
        if (evt.key === "Enter") {
            const { editorValue } = this.state;
            let normalizePath = this.path.normalize(editorValue);
            normalizePath = normalizePath.trim();

            this.editorBlurHandle();

            const { onChange } = this.props;
            onChange?.(normalizePath);
        }
    }

    btnRefreshClickHandle() {
        const { onChange, data } = this.props;
        onChange?.(data);
    }

    btnHistoryClickHandle(e: React.MouseEvent) {
        e.stopPropagation();
        const { history } = this.props;
        this.setState({
            historyOpen: history.length === 0 ? false : !this.state.historyOpen,
            quickLinksVisible: false,
        });
    }

    historyItemClickHandle(path: string) {
        const { onChange } = this.props;
        onChange?.(path);

        this.setState({
            historyOpen: false,
        });
    }

    btnHomeClickHandle(e: React.MouseEvent) {
        e.stopPropagation();
        const { quickLinks } = this.state;
        const { quickLinksVisible, breadcrumbLeft } = this.state;
        if (
            breadcrumbLeft >= 5 &&
            !quickLinksVisible &&
            quickLinks.length === 1
        ) {
            this.btnHomeItemClickHandle(quickLinks[0].path);
            return;
        }

        this.setState({
            quickLinksVisible: !quickLinksVisible,
            historyOpen: false,
            activedIndex: null,
            previewModeActived: false,
        });
    }

    btnHomeItemClickHandle(item: string) {
        const { onChange } = this.props;
        const path = item;
        onChange?.(path);

        this.setState({
            quickLinksVisible: false,
        });
    }

    handleClickOutside() {
        console.log("Pathbar: @handleClickOutside", this.state.isFocus);
        this.setState({
            historyOpen: false,
            quickLinksVisible: false,
            dirList: [],
            activedIndex: null,
            previewModeActived: false,
        });
    }

    getFileFullpath(fileUrlOrPath: string) {
        // @TODO: fileUrl
        return fileUrlOrPath;
    }

    inputSearchChangeHandle(evt: React.ChangeEvent<HTMLInputElement>) {
        this.setState({
            searchValue: evt.target.value,
        });
    }

    inputSearchKeyDownHandle(evt: React.KeyboardEvent<HTMLInputElement>) {
        if (evt.key === "Enter") {
            this.btnSearchClickHandle();
        }
    }

    btnClearSearchClickHandle() {
        this.setState({
            searchValue: "",
        });
        const { data, onChange } = this.props;
        if (isSearchUri(data)) {
            const searchLocation = parseSearchUri(data).searchLocation;
            onChange?.(searchLocation);
            return;
        }
    }

    btnSearchClickHandle() {
        const { data, onChange } = this.props;
        if (this.state.searchValue === "") {
            this.btnClearSearchClickHandle();
            return;
        }
        const path = buildSearchUri(
            data,
            this.state.searchValue,
            this.path.sep,
        );
        onChange?.(path);
    }

    generateSearchDisplay(data: string) {
        const { dirName } = parseSearchUri(data);
        return i18n.t("pathbar_search_displayname", { target: dirName });
    }
}
