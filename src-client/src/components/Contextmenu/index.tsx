import classNames from "classnames";

import "./index.css";

import { popupCreator } from "./popupCreator";
import useContextMenuCore from "./useContextMenuCore";

import type { IContextmenuDataItem } from "./typings";

const defaultActiveInfo = {
    x: 0,
    y: 0,
    visible: false,
};

function preventDefault(evt: { preventDefault: () => void }) {
    evt.preventDefault();
}

function Contextmenu(props: {
    data: IContextmenuDataItem[];
    x: number;
    y: number;
    destroy: () => void;
}) {
    const {
        menuList,
        menusActiveInfo,
        menuItemsHoverInfo,
        handleMenuMouseEnter,
        handleMenuMouseLeave,
        handleMenuItemMouseEnter,
        handleMenuItemMouseLeave,
        setMenuElRef,
    } = useContextMenuCore(props);

    return (
        <>
            {menuList.map((menu) => {
                const info = menusActiveInfo[menu.id] || defaultActiveInfo;
                return (
                    <ul
                        ref={setMenuElRef.bind(null, menu.id)}
                        key={menu.id}
                        className="pcd-contextmenu"
                        style={{
                            left: info.x,
                            top: info.y,
                            display: "block",
                            visibility: info.visible ? "visible" : "hidden",
                        }}
                        onContextMenu={preventDefault}
                        onMouseEnter={handleMenuMouseEnter.bind(null, menu)}
                        onMouseLeave={handleMenuMouseLeave.bind(null, menu)}
                    >
                        {menu.map((menuItem) => {
                            const cls = classNames({
                                hover: menuItemsHoverInfo[menuItem.id],
                                disabled: menuItem.disabled,
                            });
                            switch (menuItem.type) {
                                case "divider":
                                case "separator":
                                    return (
                                        <li
                                            key={menuItem.id}
                                            className="divider"
                                        />
                                    );
                                default:
                                    return (
                                        <li
                                            key={menuItem.id}
                                            className={cls}
                                            onClick={
                                                menuItem.disabled
                                                    ? undefined
                                                    : menuItem.click
                                            }
                                            onMouseEnter={handleMenuItemMouseEnter.bind(
                                                null,
                                                menuItem,
                                            )}
                                            onMouseLeave={handleMenuItemMouseLeave.bind(
                                                null,
                                                menuItem,
                                            )}
                                        >
                                            <div>
                                                <span className="menu-icon">
                                                    {typeof menuItem.iconRender ===
                                                    "function" ? (
                                                        menuItem.iconRender()
                                                    ) : menuItem.iconCls ? (
                                                        <i
                                                            className={
                                                                "menuiten-icon " +
                                                                menuItem.iconCls
                                                            }
                                                        />
                                                    ) : null}
                                                </span>
                                                <span
                                                    style={menuItem.labelStyle}
                                                >
                                                    {menuItem.label}
                                                </span>
                                                {menuItem.tooltip !==
                                                    undefined && (
                                                    <span className="key-tooltip">
                                                        {menuItem.tooltip}
                                                    </span>
                                                )}
                                                {menuItem.subMenuId !==
                                                    undefined && (
                                                    <i className="submenu-indicator" />
                                                )}
                                            </div>
                                        </li>
                                    );
                            }
                        })}
                    </ul>
                );
            })}
        </>
    );
}

const popContextMenu = popupCreator(Contextmenu);

export default popContextMenu;
