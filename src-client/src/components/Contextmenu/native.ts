import ContextMenuCore from "./core";

import type { IContextmenuDataItem } from "./typings";

import "./index.css";

export interface NativeContextMenuOptions {
    container?: HTMLElement;
    theme?: "dark" | "light";
}

interface NativeContextMenuDataItem
    extends Omit<
        IContextmenuDataItem,
        "children" | "click" | "iconRender" | "labelStyle"
    > {
    children?: NativeContextMenuDataItem[];
    click?: (event: MouseEvent) => void;
    iconRender?: () => Node | string | undefined;
    labelStyle?: Partial<CSSStyleDeclaration>;
}

let activeNativeContextMenuDestroy: (() => void) | undefined;

function appendIcon(target: HTMLElement, item: IContextmenuDataItem): void {
    const icon = document.createElement("span");
    icon.className = "menu-icon";

    if (typeof item.icon === "string") {
        icon.textContent = item.icon;
    } else if (item.icon instanceof Node) {
        icon.appendChild(item.icon);
    } else if (typeof item.iconRender === "function") {
        const rendered = item.iconRender();
        if (typeof rendered === "string") {
            icon.textContent = rendered;
        } else if (rendered instanceof Node) {
            icon.appendChild(rendered);
        }
    } else if (item.iconCls) {
        const iconElement = document.createElement("i");
        iconElement.className = `menuiten-icon ${item.iconCls}`;
        icon.appendChild(iconElement);
    }

    target.appendChild(icon);
}

function setMenuState(
    menuElements: Map<number, HTMLUListElement>,
    activeInfo: Record<
        string,
        { x: number; y: number; visible: boolean } | undefined
    >,
): void {
    for (const [menuId, menuElement] of menuElements) {
        const info = activeInfo[menuId];
        if (!info) continue;
        menuElement.style.left = `${info.x}px`;
        menuElement.style.top = `${info.y}px`;
        menuElement.style.visibility = info.visible ? "visible" : "hidden";
    }
}

/**
 * Render a context menu without React. The returned handle removes the menu
 * and all event listeners created for it.
 */
export function popupNativeContextMenu(
    data: NativeContextMenuDataItem[],
    x: number,
    y: number,
    options: NativeContextMenuOptions = {},
): { destroy: () => void } {
    activeNativeContextMenuDestroy?.();

    const container = options.container || document.body;
    const containerRect = container.getBoundingClientRect();
    const positionX = options.container ? x - containerRect.left : x;
    const positionY = options.container ? y - containerRect.top : y;
    const menuRoot = document.createElement("div");
    const menuElements = new Map<number, HTMLUListElement>();
    const itemElements = new Map<number, HTMLLIElement>();
    let destroyed = false;

    menuRoot.className = "pcd-contextmenu-native";
    menuRoot.style.position = "absolute";
    menuRoot.style.inset = "0";
    menuRoot.style.zIndex = "1000";
    container.appendChild(menuRoot);

    const core = new ContextMenuCore({
        data: data as IContextmenuDataItem[],
        x: positionX,
        y: positionY,
        onMenuActiveChange: (activeInfo) =>
            setMenuState(menuElements, activeInfo),
        onMenuItemHoverChange: (hoverInfo) => {
            for (const [itemId, element] of itemElements) {
                element.classList.toggle("hover", hoverInfo[itemId] === true);
            }
        },
    });

    for (const menu of core.menuList) {
        const menuElement = document.createElement("ul");
        menuElement.className = `pcd-contextmenu pcd-contextmenu-${
            options.theme || "light"
        }`;
        menuElement.style.display = "block";
        menuElement.style.visibility = "hidden";
        menuElement.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
        menuElement.addEventListener("mouseenter", () =>
            core.handleMenuMouseEnter(menu),
        );
        menuElement.addEventListener("mouseleave", () =>
            core.handleMenuMouseLeave(menu),
        );

        for (const menuItem of menu) {
            const itemElement = document.createElement("li");
            itemElement.className = menuItem.disabled ? "disabled" : "";
            itemElements.set(menuItem.id, itemElement);

            if (
                menuItem.type === "divider" ||
                menuItem.type === "separator"
            ) {
                itemElement.className = "divider";
            } else {
                const content = document.createElement("div");
                appendIcon(content, menuItem);
                const label = document.createElement("span");
                label.textContent = menuItem.label || "";
                if (menuItem.labelStyle) {
                    Object.assign(label.style, menuItem.labelStyle);
                }
                content.appendChild(label);

                if (menuItem.tooltip !== undefined) {
                    const tooltip = document.createElement("span");
                    tooltip.className = "key-tooltip";
                    tooltip.textContent = menuItem.tooltip;
                    content.appendChild(tooltip);
                }
                if (menuItem.subMenuId !== undefined) {
                    const indicator = document.createElement("i");
                    indicator.className = "submenu-indicator";
                    content.appendChild(indicator);
                }

                itemElement.appendChild(content);
                itemElement.addEventListener("mouseenter", (event) =>
                    core.handleMenuItemMouseEnter(menuItem, {
                        currentTarget: event.currentTarget as HTMLElement,
                    }),
                );
                itemElement.addEventListener("mouseleave", () =>
                    core.handleMenuItemMouseLeave(menuItem),
                );
                itemElement.addEventListener("click", (event) => {
                    if (menuItem.disabled) return;
                    (
                        menuItem.click as unknown as
                            | ((event: MouseEvent) => void)
                            | undefined
                    )?.(event);
                    destroy();
                });
            }
            menuElement.appendChild(itemElement);
        }

        menuElements.set(menu.id, menuElement);
        core.setMenuElRef(menu.id, menuElement);
        menuRoot.appendChild(menuElement);
    }

    const onDocumentClick = (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof Node) || !menuRoot.contains(target)) {
            destroy();
        }
    };
    const onDocumentPointerDown = (event: PointerEvent) => {
        const target = event.target;
        if (!(target instanceof Node) || !menuRoot.contains(target)) {
            destroy();
        }
    };
    const onDocumentContextMenu = (event: MouseEvent) => {
        if (!menuRoot.contains(event.target as Node)) destroy();
    };
    const onDocumentKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") destroy();
    };
    document.addEventListener("click", onDocumentClick, true);
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.addEventListener("contextmenu", onDocumentContextMenu, false);
    document.addEventListener("keydown", onDocumentKeyDown, true);

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        document.removeEventListener("click", onDocumentClick, true);
        document.removeEventListener(
            "pointerdown",
            onDocumentPointerDown,
            true,
        );
        document.removeEventListener(
            "contextmenu",
            onDocumentContextMenu,
            false,
        );
        document.removeEventListener("keydown", onDocumentKeyDown, true);
        menuRoot.remove();
        if (activeNativeContextMenuDestroy === destroy) {
            activeNativeContextMenuDestroy = undefined;
        }
    }

    core.adjustMainMenuPosition();
    activeNativeContextMenuDestroy = destroy;
    return { destroy };
}

export default popupNativeContextMenu;
