import {
    CloseCircleFilled,
    DesktopOutlined,
    DoubleLeftOutlined,
    DownloadOutlined,
    DownOutlined,
    FileTextOutlined,
    FolderOutlined,
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
    hidden?: boolean;
}

interface IProps {
    className?: string;
    data: string;
    host: string;
    /** 远端视图快速链接，本机是异步获取，且返回的是文件对象列表 */
    quickLinks: IQuickLink[];
    isRemote?: boolean;
    enableHomeIcon?: boolean;
    /** 是否允许用户交互点击路径栏，显示下拉目录等 */
    enableReact?: boolean;
    /** 是否允许手动输入路径 */
    enableInput?: boolean;
    /** 是否允许编辑完整路径 */
    enableEditFullpath?: boolean;
    /** 是否允许搜索 */
    enableSearch?: boolean;
    history: string[];
    actions: {
        getList: (fileUrlOrPath: string) => Promise<IFile[]>;
        getQuickLinks?: () => Promise<IFile[]>;
    };
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
    quickLinks: IFile[];
    /** 远端视图当前选中的快速链接 */
    quickLink?: IQuickLink;
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

export default class PathbarBak extends Component<IProps, IState> {
    /** nodejs path 模块 */
    path: typeof path;
    difference: number;
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
        enableEditFullpath: true,
        enableSearch: false,
        onChange: null,
    };
    constructor(props: IProps) {
        super(props);

        this.path = props.isRemote ? pathPosix : path;
        const quickLink = this.findCurQuickLink(
            props.data,
            props.quickLinks || [],
        );
        const routes = this.generateRoutes(props.data, quickLink);
        const editorValue = this.generateEditorValue(props.data, quickLink);
        const history = this.generateHisotory(props.history, props.quickLinks);

        this.state = {
            historyOpen: false,
            editorValue,
            routes,
            history,
            isFocus: false,
            breadcrumbLeft: 5,
            quickLinksVisible: false,
            quickLinks: [],
            quickLink,
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
        this.difference = 0;
        this.dirListCache = {};

        this.resizeViewThrottle = throttle(() => this.resizeView(), 200);

        this.rootElRef = createRef<HTMLDivElement>();
        this.breadcrumbBoxRef = createRef<HTMLDivElement>();
        this.breadcrumbRef = createRef<HTMLDivElement>();
        this.routeItemRefsMap = {};
    }

    componentDidMount() {
        if (!this.rootElRef.current) return;
        this.resizeViewThrottle();
        this.getQuickLinks(this.props);

        this._resizeObserver = new ResizeObserver((_entries, observer) => {
            const rootEl = this.rootElRef.current;
            if (!rootEl) {
                observer.disconnect();
                return;
            }
            this.resizeViewThrottle();
        });
        this._resizeObserver.observe(this.rootElRef.current);
    }

    componentDidUpdate(preProps: IProps) {
        const { data, quickLinks, history: curHistory } = this.props;
        if (
            preProps.data !== data ||
            preProps.history !== curHistory ||
            preProps.quickLinks !== quickLinks
        ) {
            //TODO: 变化触发不及时，当路径是过程目录时，没有及时更新界面
            const quickLink = this.findCurQuickLink(data, quickLinks || []);
            const routes = this.generateRoutes(data, quickLink);
            const history = this.generateHisotory(curHistory, quickLinks);
            const newState = {
                quickLink,
                routes,
                history,
                editorValue: this.state.editorValue,
                searchValue: parseSearchUri(data).searchValue,
            };
            if (!this.state.isFocus) {
                newState.editorValue = this.generateEditorValue(
                    data,
                    quickLink,
                );
            }
            this.setState(newState, () => this.resizeViewThrottle());
        }
    }

    componentWillUnmount() {
        this._resizeObserver.disconnect();
        this._resizeObserver = null as unknown as ResizeObserver;
    }

    render() {
        const {
            className,
            enableHomeIcon,
            enableReact,
            enableEditFullpath,
            enableSearch,
            quickLinks: remoteQuickLinks,
        } = this.props;
        const {
            historyOpen,
            editorValue,
            searchValue,
            routes,
            history,
            isFocus,
            breadcrumbLeft,
            quickLinksVisible,
            quickLinks: localQuickLinks,
            quickLink,
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
            pathbarRootCls: true,
            [className || ""]: className !== undefined,
        });
        const inputGroupCls = classNames({
            "path-content": true,
            open: historyOpen,
        });

        return (
            <div
                ref={this.rootElRef}
                className={rootCls}
                onPointerUp={this.handleClickOutside.bind(this)}
            >
                {enableHomeIcon || hiddenRoutes.length > 0 ? (
                    <div
                        className={classNames({
                            homebox: true,
                            open: quickLinksVisible,
                        })}
                    >
                        <button
                            type="button"
                            className={classNames({
                                "btn dropdown-btn home-btn": true,
                                hover: quickLinksVisible,
                            })}
                            // @ts-ignore
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
                            className="dropdown-menu home-menu dir-menu"
                            style={{ left: "0px" }}
                        >
                            {hiddenRoutes.map((item) => (
                                <li
                                    key={item.path}
                                    onPointerUp={this.handleClickHiddenRoute.bind(
                                        this,
                                        item,
                                    )}
                                >
                                    <div>
                                        <i className="file-icon file-icon-folder" />
                                        <span>{item.name}</span>
                                    </div>
                                </li>
                            ))}
                            {remoteQuickLinks.length + localQuickLinks.length >
                                0 && (
                                <li>
                                    <ul className="drop-menu-home-menu">
                                        {remoteQuickLinks
                                            .filter(
                                                (item) => item.hidden !== true,
                                            )
                                            .map((item) => (
                                                <li key={item.path}>
                                                    <div
                                                        onPointerUp={(e) => {
                                                            e.preventDefault();
                                                            this.btnHomeItemClickHandle(
                                                                item.path,
                                                            );
                                                        }}
                                                    >
                                                        <FolderOutlined />
                                                        {item.name}
                                                    </div>
                                                </li>
                                            ))}
                                        {localQuickLinks.map((item) => (
                                            <li key={item.url}>
                                                <div
                                                    className="link-color"
                                                    onPointerUp={(e) => {
                                                        e.preventDefault();
                                                        this.btnHomeItemClickHandle(
                                                            item,
                                                        );
                                                    }}
                                                >
                                                    {item.name === "/" && (
                                                        <LaptopOutlined />
                                                    )}
                                                    {item.name === "Home" && (
                                                        <HomeOutlined />
                                                    )}
                                                    {item.name ===
                                                        "Desktop" && (
                                                        <DesktopOutlined />
                                                    )}
                                                    {item.name ===
                                                        "Documents" && (
                                                        <FileTextOutlined />
                                                    )}
                                                    {item.name ===
                                                        "Downloads" && (
                                                        <DownloadOutlined />
                                                    )}
                                                    {i18n.t(
                                                        `pathbar_home_path_${item.name}`,
                                                    ) || item.name}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </li>
                            )}
                        </ul>
                    </div>
                ) : (
                    ""
                )}
                {previewModeActived && (
                    <div
                        className={classNames({
                            open: true,
                        })}
                    >
                        <ul
                            className="dropdown-menu home-menu dir-menu"
                            style={{
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
                                        onPointerUp={this.handleClickDir.bind(
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
                                            <i className="file-icon file-icon-folder" />
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
                                {!enableEditFullpath && quickLink && (
                                    <span>{quickLink.name}</span>
                                )}
                                <input
                                    type="text"
                                    className="editorInput"
                                    onChange={this.editorChangeHandle.bind(
                                        this,
                                    )}
                                    onKeyDown={this.editorKeyDownHandle.bind(
                                        this,
                                    )}
                                    onBlur={this.editorBlurHandle.bind(this)}
                                    value={editorValue}
                                />
                            </div>
                        ) : (
                            <div
                                className="form-control breadcrumbBox"
                                ref={this.breadcrumbBoxRef}
                                onPointerUp={this.editorFocusHandle.bind(this)}
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
                                            // @ts-ignore
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
                                                        // @ts-ignore
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
                                                    // @ts-ignore
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
                            type="button"
                            className={classNames({
                                "btn dropdown-btn history-btn": true,
                                hover: historyOpen,
                            })}
                            // @ts-ignore
                            onClick={this.btnHistoryClickHandle.bind(this)}
                        >
                            <DownOutlined />
                        </button>
                    </div>
                    <ul className="dropdown-menu">
                        {history.map((item) => (
                            <li key={item.path}>
                                <div
                                    className="link-color"
                                    onPointerUp={(e) => {
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
                            type="button"
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

    handleSelectDirList(route: IRouteItem, i: number, e: MouseEvent) {
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

    handleMouseOver(route: IRouteItem, i: number, e: MouseEvent) {
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
        const { actions } = this.props;
        const { routes, breadcrumbLeft } = this.state;
        const path = routes[i].path;
        const newDirListLeft =
            // @ts-ignore
            this.routeItemRefsMap[`link${i}`].getBoundingClientRect().left -
            // @ts-ignore
            this.routeItemRefsMap.link0.getBoundingClientRect().left;
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
            actions
                .getList(path)
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

    getQuickLinks(props: IProps) {
        const { isRemote, enableHomeIcon, actions } = props;
        if (isRemote || !enableHomeIcon || !actions) {
            return;
        }
        if (actions.getQuickLinks) {
            actions.getQuickLinks().then((list) => {
                this.setState({ quickLinks: list });
            });
        }
    }

    findCurQuickLink(data: string, quickLinks: IQuickLink[]) {
        let quickLink: IQuickLink | undefined;
        if (quickLinks.length > 0) {
            quickLink = quickLinks.find(
                (quickLink) => data.indexOf(quickLink.path) === 0,
            );
        }
        return quickLink;
    }

    generateRoutes(data: string, quickLink?: IQuickLink) {
        const sep: string = this.path.sep;
        const routes: IRouteItem[] = [];
        let arr: string[];
        let fullpath = "";
        let title = "";

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

        if (quickLink) {
            arr = data.substring(quickLink.path.length).split(sep);
            fullpath = quickLink.path;
            title = this.getFileFullpath(quickLink.path);
            routes.push({
                name: quickLink.name,
                title,
                path: quickLink.path,
                link: true,
            });
        } else {
            arr = data === sep ? [] : data.split(sep);
            fullpath = "";
            title = "";
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
        }
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

    generateEditorValue(data: string, quickLink?: IQuickLink) {
        if (!this.props.enableEditFullpath && quickLink) {
            return data.substring(quickLink.path.length);
        }
        return this.getFileFullpath(data);
    }

    generateHisotory(data: string[], quickLinks: IQuickLink[]) {
        return data.map((item) => {
            let name = item;

            if (isSearchUri(item)) {
                return {
                    name: this.generateSearchDisplay(item),
                    path: item,
                };
            }

            if (
                !quickLinks.some((quickLink) => {
                    const len = quickLink.path.length;
                    if (item.length >= len) {
                        if (item.substr(0, len) === quickLink.path) {
                            name =
                                quickLink.name +
                                item.substring(quickLink.path.length);
                            return true;
                        }
                    }
                })
            ) {
                name = this.getFileFullpath(item);
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
        const editorValue = this.generateEditorValue(
            this.props.data,
            this.state.quickLink,
        );
        this.setState({
            editorValue,
            isFocus: false,
        });
    }

    clickPathHandle(route: IRouteItem, e: MouseEvent) {
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
            const { host } = this.props;
            const { editorValue, quickLink } = this.state;
            let normalizePath = "";
            if (!this.props.enableEditFullpath && quickLink) {
                normalizePath = this.path.normalize(
                    `${quickLink.path}/${editorValue}/.`,
                );
            } else {
                normalizePath = this.path.normalize(
                    `${host === "localhost" ? "" : host}${editorValue}/.`,
                );
            }
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

    btnHistoryClickHandle(e: MouseEvent) {
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

    btnHomeClickHandle(e: MouseEvent) {
        e.stopPropagation();
        const { quickLinks } = this.props;
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

    btnHomeItemClickHandle(item: IFile | string) {
        const { onChange } = this.props;
        const path = typeof item === "string" ? item : item.url;
        onChange?.(path);

        this.setState({
            quickLinksVisible: false,
        });
    }

    handleClickOutside() {
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
