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
    StarFilled,
    StarOutlined,
    UnorderedListOutlined,
} from "@ant-design/icons";
import { Input, message, Popconfirm, Spin } from "antd";
import classNames from "clsx";
import throttle from "lodash/throttle";
import { Component, createRef } from "react";

import path, { posix as pathPosix } from "@/helpers/path";
import i18n from "@/i18n";

import "./index.css";

import {
    getFavoriteDirectoryList,
    postFavoriteDirectoryAdd,
    postFavoriteDirectoryRemove,
} from "@/api";
import { getFilePath, isSftpFileUri } from "@/helpers/file_uri";

import {
    appendFavoriteDirectoryMenuItem,
    favoriteDirectoryToMenuItem,
    getFavoriteDirectoryDefaultKind,
    getFavoriteDirectoryDefaultName,
    getFavoriteDirectoryLocation,
} from "./favorite_directory";
import { buildSearchUri, isSearchUri, parseSearchUri } from "./search";

import type { DebouncedFuncLeading } from "lodash";
import type { IViewFileStat } from "@/types";
import type { IFavoriteDirectoryMenuItem } from "./favorite_directory";

interface IRouteItem {
    name: string;
    title: string;
    path: string;
    link: boolean;
}

interface IPathLink {
    name: string;
    path: string;
}

interface IProps {
    className?: string;
    cwd: string;
    history: string[];
    /** 是否是posix风格路径 */
    posix?: boolean;
    /** 是否启用收藏目录图标 */
    enableFavoriteDirectoryIcon?: boolean;
    /** 是否允许用户交互点击路径栏，显示下拉目录等 */
    enableReact?: boolean;
    /** 是否允许手动输入路径 */
    enableInput?: boolean;
    /** 是否允许搜索 */
    enableSearch?: boolean;
    getDirs?: (fileUrlOrPath: string) => Promise<IViewFileStat[]>;
    getCwdFiles: () => void;
    onChange?: (newPath: string) => void;
}

interface IState {
    /** 访问过的路径历史记录下拉框是否打开 */
    historyOpen: boolean;
    /** 编辑模式下，文本框中的值 */
    editorValue: string;
    /** 路径原始值格式化后的数据 */
    routes: IRouteItem[];
    history: IPathLink[];
    /** 是否聚焦, 聚焦后, 进入编辑模式, 显示路径的原始值, 可直接输入路径 */
    isFocus: boolean;
    /** 收藏目录下拉框是否显示 */
    favoriteDirectoryMenuVisible: boolean;
    /** 收藏目录列表是否已加载 */
    favoriteDirectoriesLoaded: boolean;
    /** 服务端收藏目录列表 */
    favoriteDirectories: IFavoriteDirectoryMenuItem[];
    /** 收藏目录增删请求是否正在执行 */
    favoriteDirectoryUpdating: boolean;
    /** 添加收藏目录名称浮层是否显示 */
    favoriteDirectoryPopoverOpen: boolean;
    /** 添加收藏目录名称 */
    favoriteDirectoryName: string;
    /** 打开添加收藏目录浮层时的路径 */
    favoriteDirectoryPendingCwd: string;
    /** 隐藏的路径, 路径长度超出路径栏时，超出可视区域前面部分会收到收藏目录下拉框里 */
    hiddenRoutes: IRouteItem[];
    /** 是否已激活快速预览子目录模式 */
    previewModeActived: boolean;
    /** 快速预览子目录模式下, 激活的路径项索引 */
    activedIndex: number | null;
    /** 快速预览子目录模式下, 激活的路径项的路径 */
    activedPath: string;
    /** 快速预览子目录模式下, 显示的目录列表 */
    dirList: IViewFileStat[];
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
    dirListCache: Record<string, IViewFileStat[]>;
    resizeViewThrottle: DebouncedFuncLeading<() => void>;
    rootElRef: React.RefObject<HTMLDivElement>;
    breadcrumbBoxRef: React.RefObject<HTMLDivElement>;
    breadcrumbRef: React.RefObject<HTMLDivElement>;
    routeItemRefsMap: Record<string, HTMLSpanElement | null>;
    favoriteDirectoryListRequestId = 0;
    favoriteDirectoryMutationRequestId = 0;
    _resizeObserver!: ResizeObserver;

    static defaultProps = {
        className: "",
        cwd: "",
        history: [],
        enableFavoriteDirectoryIcon: true,
        enableReact: true,
        enableInput: true,
        enableSearch: false,
        onChange: null,
    };

    constructor(props: IProps) {
        super(props);

        this.path = props.posix ? pathPosix : path;
        const routes = this.generateRoutes(props.cwd);
        const editorValue = this.generateEditorValue(props.cwd);
        const history = this.generateHisotory(props.history);

        this.state = {
            historyOpen: false,
            editorValue,
            routes,
            history,
            isFocus: false,
            breadcrumbLeft: 5,
            favoriteDirectoryMenuVisible: false,
            favoriteDirectoriesLoaded: false,
            favoriteDirectories: [],
            favoriteDirectoryUpdating: false,
            favoriteDirectoryPopoverOpen: false,
            favoriteDirectoryName: "",
            favoriteDirectoryPendingCwd: "",
            hiddenRoutes: [],
            previewModeActived: false,
            activedIndex: null,
            activedPath: "",
            dirList: [],
            dirListLeft: null,
            dirListLoading: false,
            dirListLoadingMsg: "",
            searchValue: parseSearchUri(props.cwd).searchValue,
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
        if (this.props.cwd) {
            this.getFavoriteDirectories();
        }

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
        const { cwd, history: curHistory } = this.props;
        if (preProps.cwd !== cwd || preProps.history !== curHistory) {
            const routes = this.generateRoutes(cwd);
            const history = this.generateHisotory(curHistory);
            const newState = {
                routes,
                history,
                editorValue: this.state.editorValue,
                searchValue: parseSearchUri(cwd).searchValue,
            };
            if (!this.state.isFocus) {
                newState.editorValue = this.generateEditorValue(cwd);
            }
            this.setState(newState, () => this.resizeViewThrottle());
        }
        if (
            preProps.cwd !== cwd &&
            cwd &&
            (!preProps.cwd ||
                getFavoriteDirectoryLocation(preProps.cwd).targetId !==
                    getFavoriteDirectoryLocation(cwd).targetId)
        ) {
            this.getFavoriteDirectories();
        }
    }

    componentWillUnmount() {
        this.favoriteDirectoryListRequestId += 1;
        this.favoriteDirectoryMutationRequestId += 1;
        this._resizeObserver.disconnect();
        this._resizeObserver = null as unknown as ResizeObserver;
        document.removeEventListener("click", this.handleClickOutside);
    }

    render() {
        const {
            className,
            cwd,
            enableFavoriteDirectoryIcon,
            enableReact,
            enableSearch,
        } = this.props;
        const {
            historyOpen,
            editorValue,
            searchValue,
            routes,
            history,
            isFocus,
            breadcrumbLeft,
            favoriteDirectoryMenuVisible,
            favoriteDirectories,
            favoriteDirectoriesLoaded,
            favoriteDirectoryUpdating,
            favoriteDirectoryPopoverOpen,
            favoriteDirectoryName,
            hiddenRoutes,
            activedIndex,
            dirList,
            dirListLeft,
            previewModeActived,
            activedPath,
            dirListLoading,
            dirListLoadingMsg,
        } = this.state;
        const isFavoriteDirectory = favoriteDirectories.some((item) =>
            this.isSameLocation(item.path, cwd),
        );
        const favoriteDirectoryDisabled =
            !favoriteDirectoriesLoaded ||
            favoriteDirectoryUpdating ||
            !cwd ||
            isSearchUri(cwd);
        const rootCls = classNames({
            pathbar: true,
            [className || ""]: className !== undefined,
        });

        return (
            <div
                ref={this.rootElRef}
                className={rootCls}
                onClick={this.handleClickOutside.bind(this)}
            >
                {enableFavoriteDirectoryIcon || hiddenRoutes.length > 0 ? (
                    <div className="pathbarFavoriteDirectoryMenuBox">
                        <button
                            type="button"
                            className={classNames({
                                "pathbarDropdownBtn pathbarFavoriteDirectoryMenuBtn": true,
                                hover: favoriteDirectoryMenuVisible,
                            })}
                            title={i18n.t("pathbar_favorite_directory_list")}
                            aria-label={i18n.t(
                                "pathbar_favorite_directory_list",
                            )}
                            onClick={this.btnFavoriteDirectoryMenuClickHandle.bind(
                                this,
                            )}
                        >
                            {!favoriteDirectoryMenuVisible ? (
                                breadcrumbLeft < 5 ? (
                                    <DoubleLeftOutlined />
                                ) : (
                                    <UnorderedListOutlined />
                                )
                            ) : (
                                <DownOutlined />
                            )}
                        </button>
                        <ul
                            className="pathbarDropdownMenu pathbarDropdownMenuDirMenu"
                            style={{
                                display: favoriteDirectoryMenuVisible
                                    ? "block"
                                    : "none",
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
                            {favoriteDirectories.length > 0 && (
                                <li>
                                    <ul className="pathbarDropdownMenuFavoriteDirectoryMenu">
                                        {favoriteDirectories.map((item) => {
                                            const defaultKind =
                                                getFavoriteDirectoryDefaultKind(
                                                    item,
                                                );
                                            const name = defaultKind
                                                ? i18n.t(
                                                      `pathbar_favorite_directory_default_${defaultKind}`,
                                                  )
                                                : item.name;
                                            let icon = <FolderTwoTone />;
                                            switch (defaultKind) {
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
                                                    break;
                                            }

                                            return (
                                                <li key={item.path}>
                                                    <div
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            this.favoriteDirectoryItemClickHandle(
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
                                    <div className="pathbarDropdownMenuDirMenuLoading">
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
                                        key={item.name}
                                        onClick={this.handleClickDir.bind(
                                            this,
                                            item,
                                        )}
                                    >
                                        <div
                                            className={classNames({
                                                pathbarDropdownMenuDirMenuSelect:
                                                    item.name === activedPath,
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
                <div className="pathbarInputGroup">
                    <div className="pathbarInputContent">
                        {isFocus ? (
                            <div className="pathbarInputContentMain pathbarEditorWrapper">
                                <input
                                    type="text"
                                    name="pathbarEditorInput"
                                    className="pathbarEditorInput"
                                    autoFocus={true}
                                    autoComplete="off"
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
                                ref={this.breadcrumbBoxRef}
                                className="pathbarInputContentMain pathbarRouteListWrapper"
                                onClick={this.editorFocusHandle.bind(this)}
                            >
                                <div
                                    ref={this.breadcrumbRef}
                                    className={classNames({
                                        pathbarRouteList: true,
                                        pathbarRouteListDisable: !enableReact,
                                    })}
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
                                                pathbarRoute: true,
                                                pathbarRouteSelect:
                                                    activedIndex === i,
                                            })}
                                            onMouseOver={this.handleMouseOver.bind(
                                                this,
                                                route,
                                                i,
                                            )}
                                            title={route.title}
                                        >
                                            <span className="pathbarRouteName">
                                                {route.link ? (
                                                    <span
                                                        className="pathbarRouteNameLink"
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
                                                    className="pathbarRouteSeparator"
                                                >
                                                    <span
                                                        className={classNames({
                                                            pathbarRouteSeparatorDown:
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
                        {enableFavoriteDirectoryIcon && (
                            <Popconfirm
                                title={i18n.t(
                                    "pathbar_favorite_directory_name",
                                )}
                                description={
                                    <Input
                                        autoFocus={true}
                                        aria-label={i18n.t(
                                            "pathbar_favorite_directory_name",
                                        )}
                                        value={favoriteDirectoryName}
                                        onChange={this.favoriteDirectoryNameChangeHandle.bind(
                                            this,
                                        )}
                                        onPressEnter={this.favoriteDirectoryPopoverConfirmHandle.bind(
                                            this,
                                        )}
                                    />
                                }
                                icon={null}
                                placement="bottomRight"
                                open={favoriteDirectoryPopoverOpen}
                                okText={i18n.t("app_btn_ok")}
                                cancelText={i18n.t("app_btn_cancel")}
                                okButtonProps={{
                                    disabled:
                                        favoriteDirectoryName.trim() === "",
                                    loading: favoriteDirectoryUpdating,
                                }}
                                cancelButtonProps={{
                                    disabled: favoriteDirectoryUpdating,
                                }}
                                onOpenChange={this.favoriteDirectoryPopoverOpenChangeHandle.bind(
                                    this,
                                )}
                                onCancel={this.favoriteDirectoryPopoverCancelHandle.bind(
                                    this,
                                )}
                                onConfirm={this.favoriteDirectoryPopoverConfirmHandle.bind(
                                    this,
                                )}
                            >
                                <button
                                    type="button"
                                    className={classNames({
                                        "pathbarDropdownBtn pathbarFavoriteDirectoryBtn": true,
                                        active: isFavoriteDirectory,
                                    })}
                                    disabled={favoriteDirectoryDisabled}
                                    title={i18n.t(
                                        isFavoriteDirectory
                                            ? "pathbar_favorite_directory_remove"
                                            : "pathbar_favorite_directory_add",
                                    )}
                                    aria-label={
                                        isFavoriteDirectory
                                            ? i18n.t(
                                                  "pathbar_favorite_directory_remove",
                                              )
                                            : i18n.t(
                                                  "pathbar_favorite_directory_add",
                                              )
                                    }
                                    onClick={this.btnFavoriteDirectoryClickHandle.bind(
                                        this,
                                    )}
                                >
                                    {isFavoriteDirectory ? (
                                        <StarFilled />
                                    ) : (
                                        <StarOutlined />
                                    )}
                                </button>
                            </Popconfirm>
                        )}
                        <button
                            type="button"
                            className={classNames({
                                "pathbarDropdownBtn pathbarHistoryBtn": true,
                                hover: historyOpen,
                            })}
                            title={i18n.t("pathbar_history")}
                            aria-label={i18n.t("pathbar_history")}
                            onClick={this.btnHistoryClickHandle.bind(this)}
                        >
                            <DownOutlined />
                        </button>
                    </div>
                    <ul
                        className="pathbarDropdownMenu"
                        style={{
                            display: historyOpen ? "block" : "none",
                        }}
                    >
                        {history.map((item) => (
                            <li key={item.path}>
                                <div
                                    key={item.path}
                                    className="pathbarRouteNameLink"
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
                    className="pathbarIconBtn"
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
                            className="pathbarIconBtn"
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
                favoriteDirectoryMenuVisible: false,
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
            favoriteDirectoryMenuVisible: false,
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
                        activedPath: routes[i + 1].path,
                        dirList: this.dirListCache[objKey],
                        activedIndex: i,
                        dirListLoading: false,
                        dirListLoadingMsg: "",
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
                        activedIndex: i,
                        activedPath: routes[i + 1].path,
                        dirList: [],
                        dirListLoading: true,
                        dirListLoadingMsg: "",
                        dirListLeft:
                            breadcrumbLeft < 0
                                ? newDirListLeft + breadcrumbLeft
                                : newDirListLeft,
                    },
                    newState,
                ),
            );
        }

        return new Promise<IViewFileStat[]>((resolve, reject) => {
            getDirs(path)
                .then((response) => {
                    const newDirList: IViewFileStat[] = [];
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

    handleClickDir(dir: IViewFileStat) {
        if (dir.name === this.state.activedPath) {
            return;
        }

        this.props.onChange?.(getFilePath(dir.uri));
    }

    getFavoriteDirectories() {
        const { cwd } = this.props;
        const targetId = getFavoriteDirectoryLocation(cwd).targetId;
        const requestId = ++this.favoriteDirectoryListRequestId;
        this.favoriteDirectoryMutationRequestId += 1;
        this.setState({
            favoriteDirectories: [],
            favoriteDirectoriesLoaded: false,
            favoriteDirectoryUpdating: false,
            favoriteDirectoryPopoverOpen: false,
            favoriteDirectoryName: "",
            favoriteDirectoryPendingCwd: "",
        });

        getFavoriteDirectoryList(targetId)
            .then((list) => {
                if (
                    !this.isFavoriteDirectoryListRequestCurrent(
                        requestId,
                        targetId,
                    )
                ) {
                    return;
                }
                this.setState({
                    favoriteDirectories: list.map(favoriteDirectoryToMenuItem),
                    favoriteDirectoriesLoaded: true,
                });
            })
            .catch(() => {
                if (
                    !this.isFavoriteDirectoryListRequestCurrent(
                        requestId,
                        targetId,
                    )
                ) {
                    return;
                }
                this.setState({
                    favoriteDirectories: [],
                    favoriteDirectoriesLoaded: true,
                });
            });
    }

    isFavoriteDirectoryListRequestCurrent(requestId: number, targetId: number) {
        return (
            requestId === this.favoriteDirectoryListRequestId &&
            getFavoriteDirectoryLocation(this.props.cwd).targetId === targetId
        );
    }

    isFavoriteDirectoryMutationRequestCurrent(
        requestId: number,
        targetId: number,
    ) {
        return (
            requestId === this.favoriteDirectoryMutationRequestId &&
            getFavoriteDirectoryLocation(this.props.cwd).targetId === targetId
        );
    }

    isSameLocation(left: string, right: string) {
        if (left === right) return true;
        if (isSftpFileUri(left) && isSftpFileUri(right)) return false;
        if (isSftpFileUri(left)) return getFilePath(left) === right;
        if (isSftpFileUri(right)) return left === getFilePath(right);
        return false;
    }

    generateRoutes(cwd: string) {
        if (isSearchUri(cwd)) {
            return [
                {
                    name: this.generateSearchDisplay(cwd),
                    title: "",
                    path: cwd,
                    link: false,
                },
            ];
        }

        const sep = this.path.sep;
        const routes: IRouteItem[] = [];
        const arr = cwd === sep ? [] : cwd.split(sep);
        let fullpath = "";
        let title = "";

        if (isSftpFileUri(cwd)) {
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
            let name = item;

            if (isSearchUri(item)) {
                return {
                    name: this.generateSearchDisplay(item),
                    path: item,
                };
            } else if (isSftpFileUri(item)) {
                name = getFilePath(item);
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
        const editorValue = this.generateEditorValue(this.props.cwd);
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

            this.props.onChange?.(normalizePath);
        }
    }

    btnRefreshClickHandle() {
        this.props.getCwdFiles();
    }

    async btnFavoriteDirectoryClickHandle(e: React.MouseEvent) {
        e.stopPropagation();
        const { cwd } = this.props;
        if (
            !cwd ||
            isSearchUri(cwd) ||
            !this.state.favoriteDirectoriesLoaded ||
            this.state.favoriteDirectoryUpdating
        ) {
            return;
        }

        const location = getFavoriteDirectoryLocation(cwd);
        const existing = this.state.favoriteDirectories.find((item) =>
            this.isSameLocation(item.path, cwd),
        );

        if (!existing) {
            this.setState({
                favoriteDirectoryPopoverOpen: true,
                favoriteDirectoryName: getFavoriteDirectoryDefaultName(cwd),
                favoriteDirectoryPendingCwd: cwd,
                favoriteDirectoryMenuVisible: false,
                historyOpen: false,
            });
            return;
        }

        const requestId = ++this.favoriteDirectoryMutationRequestId;
        this.setState({
            favoriteDirectoryUpdating: true,
            favoriteDirectoryMenuVisible: false,
            historyOpen: false,
        });

        try {
            await postFavoriteDirectoryRemove({
                target_id: location.targetId,
                path: location.path,
            });
            if (
                !this.isFavoriteDirectoryMutationRequestCurrent(
                    requestId,
                    location.targetId,
                )
            ) {
                return;
            }
            this.setState((state) => ({
                favoriteDirectories: state.favoriteDirectories.filter(
                    (item) => !this.isSameLocation(item.path, existing.path),
                ),
            }));
        } catch {
            if (
                this.isFavoriteDirectoryMutationRequestCurrent(
                    requestId,
                    location.targetId,
                )
            ) {
                message.error(
                    i18n.t("pathbar_favorite_directory_update_failed"),
                );
            }
        } finally {
            if (
                this.isFavoriteDirectoryMutationRequestCurrent(
                    requestId,
                    location.targetId,
                )
            ) {
                this.setState({ favoriteDirectoryUpdating: false });
            }
        }
    }

    favoriteDirectoryNameChangeHandle(
        evt: React.ChangeEvent<HTMLInputElement>,
    ) {
        this.setState({ favoriteDirectoryName: evt.target.value });
    }

    favoriteDirectoryPopoverOpenChangeHandle(open: boolean) {
        if (!open) this.favoriteDirectoryPopoverCancelHandle();
    }

    favoriteDirectoryPopoverCancelHandle() {
        if (this.state.favoriteDirectoryUpdating) return;
        this.setState({
            favoriteDirectoryPopoverOpen: false,
            favoriteDirectoryName: "",
            favoriteDirectoryPendingCwd: "",
        });
    }

    async favoriteDirectoryPopoverConfirmHandle() {
        const {
            favoriteDirectoryName,
            favoriteDirectoryPendingCwd,
            favoriteDirectoryUpdating,
        } = this.state;
        const name = favoriteDirectoryName.trim();
        if (
            !name ||
            !favoriteDirectoryPendingCwd ||
            favoriteDirectoryUpdating
        ) {
            return;
        }

        const location = getFavoriteDirectoryLocation(
            favoriteDirectoryPendingCwd,
        );
        const requestId = ++this.favoriteDirectoryMutationRequestId;
        this.setState({ favoriteDirectoryUpdating: true });
        try {
            const favoriteDirectory = await postFavoriteDirectoryAdd({
                target_id: location.targetId,
                name,
                path: location.path,
            });
            if (
                !this.isFavoriteDirectoryMutationRequestCurrent(
                    requestId,
                    location.targetId,
                )
            ) {
                return;
            }
            const menuItem = favoriteDirectoryToMenuItem(favoriteDirectory);
            this.setState((state) => ({
                favoriteDirectories: appendFavoriteDirectoryMenuItem(
                    state.favoriteDirectories,
                    menuItem,
                ),
                favoriteDirectoryPopoverOpen: false,
                favoriteDirectoryName: "",
                favoriteDirectoryPendingCwd: "",
            }));
        } catch {
            if (
                this.isFavoriteDirectoryMutationRequestCurrent(
                    requestId,
                    location.targetId,
                )
            ) {
                message.error(
                    i18n.t("pathbar_favorite_directory_update_failed"),
                );
            }
        } finally {
            if (
                this.isFavoriteDirectoryMutationRequestCurrent(
                    requestId,
                    location.targetId,
                )
            ) {
                this.setState({ favoriteDirectoryUpdating: false });
            }
        }
    }

    btnHistoryClickHandle(e: React.MouseEvent) {
        e.stopPropagation();
        const { history } = this.props;
        this.setState({
            historyOpen: history.length === 0 ? false : !this.state.historyOpen,
            favoriteDirectoryMenuVisible: false,
        });
    }

    historyItemClickHandle(path: string) {
        const { onChange } = this.props;
        onChange?.(path);

        this.setState({
            historyOpen: false,
        });
    }

    btnFavoriteDirectoryMenuClickHandle(e: React.MouseEvent) {
        e.stopPropagation();
        const { favoriteDirectoryMenuVisible } = this.state;

        this.setState({
            favoriteDirectoryMenuVisible: !favoriteDirectoryMenuVisible,
            historyOpen: false,
            activedIndex: null,
            previewModeActived: false,
        });
    }

    favoriteDirectoryItemClickHandle(item: string) {
        const { onChange } = this.props;
        const path = item;
        onChange?.(path);

        this.setState({
            favoriteDirectoryMenuVisible: false,
        });
    }

    handleClickOutside() {
        console.log("Pathbar: @handleClickOutside", this.state.isFocus);
        this.setState({
            historyOpen: false,
            favoriteDirectoryMenuVisible: false,
            dirList: [],
            activedIndex: null,
            previewModeActived: false,
        });
    }

    getFileFullpath(fileUrlOrPath: string) {
        if (isSftpFileUri(fileUrlOrPath)) {
            return getFilePath(fileUrlOrPath);
        }
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
        const { cwd, onChange } = this.props;
        if (isSearchUri(cwd)) {
            const searchLocation = parseSearchUri(cwd).searchLocation;
            onChange?.(searchLocation);
            return;
        }
    }

    btnSearchClickHandle() {
        const { cwd, onChange } = this.props;
        if (this.state.searchValue === "") {
            this.btnClearSearchClickHandle();
            return;
        }
        const path = buildSearchUri(cwd, this.state.searchValue, this.path.sep);
        onChange?.(path);
    }

    generateSearchDisplay(cwd: string) {
        const { dirName } = parseSearchUri(cwd);
        return i18n.t("pathbar_search_displayname", { target: dirName });
    }
}
