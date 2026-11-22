import {
    CloseOutlined,
    ColumnHeightOutlined,
    ColumnWidthOutlined,
    DesktopOutlined,
    PlusOutlined,
} from "@ant-design/icons";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { getActiveView } from "./layout";
import TabPanes from "./TabPanes";
import getTabIcon from "./tabIcon";

import type { ITab } from "@/store";

interface ContentProps {
    activeTabKey: string;
    onAddTab: () => void;
    onSplitView: (direction: "horizontal" | "vertical") => void;
    onCloseSplitView: () => void;
    mountedTabKeys: ReadonlySet<string>;
    tabs: ITab[];
}

const Content = memo(function Content({
    activeTabKey,
    onAddTab,
    onSplitView,
    onCloseSplitView,
    mountedTabKeys,
    tabs,
}: ContentProps) {
    const { t } = useTranslation();
    const activeTab = tabs.find((tab) => tab.key === activeTabKey);
    const activeView = activeTab ? getActiveView(activeTab) : undefined;

    return (
        <section className="WebSSH-Home-Content">
            <header className="WebSSH-Home-ContentHeader">
                <div className="WebSSH-Home-ContentHeading">
                    {activeTab ? (
                        <>
                            <span className="WebSSH-Home-ContentIcon">
                                {getTabIcon(
                                    activeView?.path ?? activeTab.path ?? "/",
                                )}
                            </span>
                            <span className="WebSSH-Home-ContentTitle">
                                {activeView?.label ?? activeTab.label}
                            </span>
                        </>
                    ) : (
                        <span className="WebSSH-Home-ContentTitle">
                            {t("app_tab_new")}
                        </span>
                    )}
                </div>
                <div className="WebSSH-Home-SplitActions">
                    <button
                        type="button"
                        className="WebSSH-Home-SplitButton"
                        aria-label={t("app_split_horizontal")}
                        title={t("app_split_horizontal")}
                        onClick={() => onSplitView("horizontal")}
                    >
                        <ColumnWidthOutlined aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className="WebSSH-Home-SplitButton"
                        aria-label={t("app_split_vertical")}
                        title={t("app_split_vertical")}
                        onClick={() => onSplitView("vertical")}
                    >
                        <ColumnHeightOutlined aria-hidden="true" />
                    </button>
                    {activeTab?.child1 || activeTab?.child2 ? (
                        <button
                            type="button"
                            className="WebSSH-Home-SplitButton"
                            aria-label={t("app_split_close")}
                            title={t("app_split_close")}
                            onClick={onCloseSplitView}
                        >
                            <CloseOutlined aria-hidden="true" />
                        </button>
                    ) : null}
                </div>
            </header>
            <div className="WebSSH-Home-Panes">
                <TabPanes
                    activeTabKey={activeTabKey}
                    mountedTabKeys={mountedTabKeys}
                    tabs={tabs}
                />
                {tabs.length === 0 && (
                    <div className="WebSSH-Home-Empty">
                        <DesktopOutlined aria-hidden="true" />
                        <span>{t("app_tab_new")}</span>
                        <button type="button" onClick={onAddTab}>
                            <PlusOutlined aria-hidden="true" />
                            {t("app_tab_new")}
                        </button>
                    </div>
                )}
            </div>
        </section>
    );
});

export default Content;
