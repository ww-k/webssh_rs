import type { IContextmenuDataItem } from "./typings";

interface IProps {
    data: IContextmenuDataItem[];
    x: number;
    y: number;
    onMenuActiveChange?: (
        activeInfo: Record<string, IPositionInfo | undefined>,
    ) => void;
    onMenuItemHoverChange?: (hoverInfo: Record<string, boolean>) => void;
}

export interface IPositionInfo {
    x: number;
    y: number;
    visible: boolean;
}

interface IRect {
    width: number;
    height: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
}

class DelayOrder {
    id: number;
    timer?: number;
    callback?: (self: DelayOrder) => void;
    menuId?: number;
    parentMenuId?: number;
    menuItemId?: number;
    static sumCount = 0;
    constructor(callback: () => void, timeout = 0) {
        if (typeof callback !== "function") {
            throw new Error("callback must be function");
        }
        this.id = DelayOrder.sumCount++;
        this.callback = callback;
        this.timer = setTimeout(() => {
            this.execute();
        }, timeout);
    }

    dispose() {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.callback = undefined;
    }

    execute() {
        if (typeof this.callback === "function") {
            this.callback(this);
            this.dispose();
        }
    }

    cancel() {
        if (this.callback != null) {
            this.dispose();
        }
    }
}

class MenuItem implements IContextmenuDataItem {
    id: number;
    subMenuId?: number;
    subMenu?: Menu;
    parentMenuId: number;

    type?: string;
    label?: string;
    disabled?: boolean;
    iconCls?: string;
    tooltip?: string;
    labelStyle?: IContextmenuDataItem["labelStyle"];
    click?: IContextmenuDataItem["click"];
    iconRender?: IContextmenuDataItem["iconRender"];

    constructor(
        id: number,
        option: IContextmenuDataItem,
        parentMenuId: number,
    ) {
        this.id = id;
        this.parentMenuId = parentMenuId;

        this.type = option.type;
        this.label = option.label;
        this.disabled = option.disabled;
        this.iconCls = option.iconCls;
        this.tooltip = option.tooltip;
        this.labelStyle = option.labelStyle;
        this.click = option.click;
        this.iconRender = option.iconRender;
    }
}

function menuLoopFrom(
    parentMenu: Menu,
    children: IContextmenuDataItem[],
    menuIdNum: number,
    menuItemNum: number,
) {
    children.forEach((item) => {
        const menuItem = new MenuItem(++menuItemNum, item, parentMenu.id);
        parentMenu.push(menuItem);

        if (!Array.isArray(item.children)) return;

        const subMenu = new Menu(++menuIdNum);
        subMenu.parentMenuId = parentMenu.id;
        subMenu.parentMenuItemId = menuItem.id;
        menuItem.subMenu = subMenu;
        menuItem.subMenuId = subMenu.id;

        [menuIdNum, menuItemNum] = menuLoopFrom(
            subMenu,
            item.children,
            menuIdNum,
            menuItemNum,
        );
    });

    return [menuIdNum, menuItemNum];
}

const mainMenuId = 1;
class Menu extends Array<MenuItem> {
    id: number;
    parentMenuId?: number;
    parentMenuItemId?: number;

    constructor(id: number) {
        super();
        this.id = id;
    }

    static from(option: IContextmenuDataItem[]) {
        const mainMenu = new Menu(mainMenuId);
        menuLoopFrom(mainMenu, option, mainMenuId, 1);
        return mainMenu;
    }

    flatten() {
        return this.reduce<Menu[]>(
            (menus, menuItem) => {
                if (menuItem.subMenu) {
                    menus.push(...menuItem.subMenu.flatten());
                }
                return menus;
            },
            [this],
        );
    }
}

export default class ContextMenuCore {
    // 菜单实例列表, 用于渲染视图
    menuList: Menu[] = [];
    // 菜单实例map, 用于后续快捷获取菜单实例
    menuListMap: Record<string, Menu> = {};
    // 菜单dom map, 用于后续子菜单的位置的计算
    _menuElMap: Record<string, Element> = {};
    // 菜单视图显示区域信息map, 用于后续子菜单的位置的计算
    _menuRectMap: Record<string, IRect> = {};
    // 菜单视图鼠标离开事件产生的工单map, 此工单用于延迟隐藏对应的菜单视图
    _menuLeaveOrderMap: Record<string, DelayOrder> = {};
    // 菜单项视图鼠标离开事件产生的工单map, 此工单用于延迟隐藏对应的子菜单
    _menuItemLeaveOrderMap: Record<string, DelayOrder> = {};
    _curHoverMenuItemRect?: DOMRect;

    props: IProps;
    state: {
        menusActiveInfo: Record<number, IPositionInfo | undefined>;
        menuItemsHoverInfo: Record<string, boolean>;
    };

    constructor(props: IProps) {
        this.props = props;
        this.state = {
            menusActiveInfo: {},
            menuItemsHoverInfo: {},
        };
        DelayOrder.sumCount = 0;
        this._serializeData(props.data);
    }

    setMenuElRef(menuId: number, el: HTMLUListElement) {
        this._menuElMap[menuId] = el;
    }

    handleMenuMouseEnter(menu: Menu) {
        if (menu.id === mainMenuId) return;
        if (menu.parentMenuId) {
            const order1 = this._menuLeaveOrderMap[menu.parentMenuId];
            if (order1) order1.cancel();
            // 如果 `当前菜单` 的 `父菜单` 存在延迟执行工单, 则取消工单
            delete this._menuLeaveOrderMap[menu.parentMenuId];
        }

        const order2 = this._menuLeaveOrderMap[menu.id];
        // 如果 `当前菜单` 存在延迟执行工单, 则取消工单
        if (order2) order2.cancel();
        delete this._menuLeaveOrderMap[menu.id];

        if (menu.parentMenuId && this.menuListMap[menu.parentMenuId]) {
            // 手动将事件冒泡给父菜单
            this.handleMenuMouseEnter(this.menuListMap[menu.parentMenuId]);
        }
    }

    handleMenuMouseLeave(menu: Menu) {
        if (menu.id === mainMenuId) return;
        const order1 = this._menuLeaveOrderMap[menu.id];
        if (order1) order1.cancel();
        const order2 = new DelayOrder(() => {
            delete this._menuLeaveOrderMap[menu.id];
            if (menu.parentMenuId) this._updateMenuState(menu.id);
        }, 100);
        order2.menuId = menu.id;
        order2.parentMenuId = menu.parentMenuId;
        this._menuLeaveOrderMap[menu.id] = order2;

        if (menu.parentMenuId && this.menuListMap[menu.parentMenuId]) {
            // 手动将事件冒泡给父菜单
            this.handleMenuMouseLeave(this.menuListMap[menu.parentMenuId]);
        }
    }

    handleMenuItemMouseEnter(menuItem: Menu[0], evt: React.MouseEvent) {
        const order1 = this._menuItemLeaveOrderMap[menuItem.parentMenuId];
        // 如果 `当前菜单项` 所在 `菜单` 存在延迟执行工单, 则立即执行工单
        if (order1) {
            if (order1.menuItemId !== menuItem.id) {
                order1.execute();
            } else {
                order1.cancel();
            }
            delete this._menuItemLeaveOrderMap[menuItem.parentMenuId];
        }
        if (menuItem.subMenuId) {
            const order2 = this._menuLeaveOrderMap[menuItem.subMenuId];
            if (order2) order2.cancel();
            delete this._menuLeaveOrderMap[menuItem.subMenuId];
        }
        this._updateMenuItemState(menuItem.id, true);
        if (menuItem.subMenuId) {
            this._curHoverMenuItemRect =
                evt.currentTarget.getBoundingClientRect();
            this._adjustSubMenuPosition(menuItem.subMenuId);
        }
    }

    handleMenuItemMouseLeave(menuItem: Menu[0]) {
        // 记录一条延迟处理的工单. 延迟隐藏子菜单和取消自己的hover状态.
        const order = new DelayOrder(() => {
            delete this._menuItemLeaveOrderMap[menuItem.parentMenuId];
            if (menuItem.subMenuId) {
                delete this._menuLeaveOrderMap[menuItem.subMenuId];
            }
            this._updateMenuItemState(menuItem.id, false);
            if (menuItem.subMenuId) {
                this._updateMenuState(menuItem.subMenuId);
            }
        }, 100);
        order.menuId = menuItem.subMenuId;
        order.parentMenuId = menuItem.parentMenuId;
        order.menuItemId = menuItem.id;
        // 在`menuItemLeaveOrderMap`中添加该order信息, 便于后续同级菜单项鼠标进入事件中立即执行该工单
        this._menuItemLeaveOrderMap[menuItem.parentMenuId] = order;
        if (menuItem.subMenuId) {
            // 在`menuLeaveOrderMap`中添加该order信息, 便于后续子菜单鼠标离开事件中取消该工单
            this._menuLeaveOrderMap[menuItem.subMenuId] = order;
        }
    }

    /**
     * 序列化原始数据为菜单实例列表
     */
    _serializeData(data: IContextmenuDataItem[]) {
        this.menuList = Menu.from(data)
            .flatten()
            .map((item) => {
                this.menuListMap[item.id] = item;
                return item;
            });
    }

    /**
     * 调整主菜单视图的位置算法
     */
    adjustMainMenuPosition() {
        let { x, y } = this.props;
        const { innerWidth, innerHeight } = window;
        const rect = this._menuElMap[mainMenuId].getBoundingClientRect();
        const { width, height } = rect;

        if (x + width > innerWidth) {
            x = Math.max(0, x - width);
        }
        if (y + height > innerHeight) {
            y = Math.max(0, y - height);
        }

        // 记录菜单显示区域信息, 用于后续子菜单的位置的计算
        this._menuRectMap[mainMenuId] = {
            width,
            height,
            left: x,
            top: y,
            right: x + width,
            bottom: y + height,
        };
        this._updateMenuState(mainMenuId, {
            visible: true,
            x,
            y,
        });
    }

    /**
     * 调整子菜单视图的位置算法
     */
    _adjustSubMenuPosition(id: number) {
        if (!this.menuListMap[id].parentMenuId || !this._curHoverMenuItemRect)
            return;
        const menuEl = this._menuElMap[id];
        const parentMenuItemRect =
            this._menuRectMap[this.menuListMap[id].parentMenuId];

        const { innerWidth, innerHeight } = window;
        const subMenuRect = menuEl.getBoundingClientRect();
        const { left: pl, top: pt, right: pr, bottom: pb } = parentMenuItemRect;
        const { top: pit, bottom: pib } = this._curHoverMenuItemRect;
        const { width: sw, height: sh } = subMenuRect;
        // 子菜单默认在父菜单右边
        let x = pr;
        // 子菜单默认与父菜单-菜单项相同的高度
        let y = pit;
        // 如果子菜单放右边,空间不够,则尝试放左边
        if (pr + sw > innerWidth) {
            x = pl - sw;
        }
        // 如果放左边,空间也不够,则尝试放在父菜单上边或下边, 左侧对齐
        if (x < 0) {
            x = pl;
        }
        // 至此, 子菜单的left值确定了

        // 如果子菜单与父菜单左侧对齐摆放
        if (x === pl) {
            y = pb;
            // 只有当下边空间不够,上边空间够的时候才摆上面
            if (pb + sh > innerHeight && pt >= sh) {
                y = pt - sh;
            }
        } else {
            // 如果子菜单在与子菜单容器顶部对齐的情况下, 空间不够, 则采用底部对齐
            if (pit + sh > innerHeight) {
                y = pib - sh;
            }
        }

        this._menuRectMap[id] = {
            width: sw,
            height: sh,
            left: x,
            top: y,
            right: x + sw,
            bottom: y + sh,
        };
        this._updateMenuState(id, {
            visible: true,
            x,
            y,
        });
    }

    /**
     * 更新菜单位置信息
     */
    _updateMenuState(id: number, state?: IPositionInfo) {
        const { menusActiveInfo } = this.state;
        const info = menusActiveInfo[id];
        if (!state || !info) {
            menusActiveInfo[id] = state;
        } else {
            info.visible = state.visible;
            info.x = state.x;
            info.y = state.y;
        }
        this.props.onMenuActiveChange?.(menusActiveInfo);
    }

    /**
     * 更新菜单项hover信息
     */
    _updateMenuItemState(id: number, state: boolean) {
        const { menuItemsHoverInfo } = this.state;
        menuItemsHoverInfo[id] = state;
        this.props.onMenuItemHoverChange?.(menuItemsHoverInfo);
    }
}
