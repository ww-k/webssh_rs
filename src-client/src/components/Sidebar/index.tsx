import {
    DisconnectOutlined,
    FileTextOutlined,
    HomeOutlined,
    KeyOutlined,
    NodeIndexOutlined,
    SettingOutlined,
    SwapOutlined,
} from "@ant-design/icons";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import transferService from "@/services/transfer";

import "./index.css";

import type { ReactNode } from "react";

type SidebarMenuItem = {
    key: string;
    icon: ReactNode;
    label: string;
};

interface SidebarProps {
    activeMenuKey: string;
    collapsed: boolean;
    onCollapse: (collapsed: boolean) => void;
    onMenuClick: (evt: { key: string }) => void;
}

const Sidebar = memo(function Sidebar({
    activeMenuKey,
    collapsed,
    onCollapse,
    onMenuClick,
}: SidebarProps) {
    const { t } = useTranslation();
    const [newTransferCount, setNewTransferCount] = useState(0);
    const menuItems = useMemo<SidebarMenuItem[]>(() => {
        return [
            {
                key: "home",
                icon: <HomeOutlined />,
                label: t("app_menu_home"),
            },
            {
                key: "transfer",
                icon: <SwapOutlined style={{ transform: "rotate(90deg)" }} />,
                label: t("app_menu_transfer"),
            },
            {
                key: "ssh_connections",
                icon: <DisconnectOutlined />,
                label: t("app_menu_ssh_connections"),
            },
            {
                key: "port_forward",
                icon: <NodeIndexOutlined />,
                label: t("app_menu_port_forward"),
            },
            {
                key: "ssh_known_hosts",
                icon: <KeyOutlined />,
                label: t("app_menu_ssh_known_hosts"),
            },
            {
                key: "server_logs",
                icon: <FileTextOutlined />,
                label: t("app_menu_server_logs"),
            },
        ];
    }, [t]);

    const settingsMenuItems = useMemo<SidebarMenuItem[]>(
        () => [
            {
                key: "settings",
                icon: <SettingOutlined />,
                label: t("app_menu_settings"),
            },
        ],
        [t],
    );

    const handleMenuClick = useCallback(
        (key: string) => {
            onMenuClick({ key });
        },
        [onMenuClick],
    );

    useEffect(() => {
        return transferService.subscribeUnfinishedCount(setNewTransferCount);
    }, []);

    const renderMenuItem = (item: SidebarMenuItem) => {
        const selected = activeMenuKey === item.key;
        const transferCount =
            item.key === "transfer" ? newTransferCount : undefined;
        const countLabel =
            transferCount !== undefined && transferCount > 99
                ? "99+"
                : transferCount;

        return (
            <button
                key={item.key}
                type="button"
                className={`WebSSH-Root-MenuItem${selected ? " is-selected" : ""}`}
                aria-current={selected ? "page" : undefined}
                aria-label={collapsed ? item.label : undefined}
                title={collapsed ? item.label : undefined}
                onClick={() => handleMenuClick(item.key)}
            >
                <span className="WebSSH-Root-MenuIcon">
                    {item.icon}
                    {collapsed &&
                        countLabel !== undefined &&
                        countLabel !== 0 && (
                            <span className="WebSSH-Root-TransferMenuCount is-collapsed">
                                {countLabel}
                            </span>
                        )}
                </span>
                <span className="WebSSH-Root-MenuLabel">{item.label}</span>
                {!collapsed && countLabel !== undefined && countLabel !== 0 && (
                    <span className="WebSSH-Root-TransferMenuCount">
                        {countLabel}
                    </span>
                )}
            </button>
        );
    };

    return (
        <aside
            className={`WebSSH-Root-Sider${collapsed ? " is-collapsed" : ""}`}
            aria-label={t("app_menu_home")}
        >
            <nav className="WebSSH-Root-Menu">
                {menuItems.map(renderMenuItem)}
            </nav>
            <nav className="WebSSH-Root-Menu WebSSH-Root-SettingsMenu">
                {settingsMenuItems.map(renderMenuItem)}
            </nav>
            <div className="WebSSH-Root-SiderFooter">
                <button
                    type="button"
                    className="WebSSH-Root-SiderToggle"
                    aria-expanded={!collapsed}
                    aria-label={t(
                        collapsed ? "app_tab_expand" : "app_tab_collapse",
                    )}
                    title={t(collapsed ? "app_tab_expand" : "app_tab_collapse")}
                    onClick={() => onCollapse(!collapsed)}
                >
                    <span className="WebSSH-Root-MenuIcon">
                        {collapsed ? (
                            <PanelLeftOpen aria-hidden="true" />
                        ) : (
                            <PanelLeftClose aria-hidden="true" />
                        )}
                    </span>
                </button>
            </div>
        </aside>
    );
});

export default Sidebar;
