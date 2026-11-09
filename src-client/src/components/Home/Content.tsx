import { DesktopOutlined, PlusOutlined } from "@ant-design/icons";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import TabPanes from "./TabPanes";
import getTabIcon from "./tabIcon";

import type { ITab } from "@/store";

interface ContentProps {
    activeTabKey: string;
    onAddTab: () => void;
    mountedTabKeys: ReadonlySet<string>;
    tabs: ITab[];
}

const Content = memo(function Content({
    activeTabKey,
    onAddTab,
    mountedTabKeys,
    tabs,
}: ContentProps) {
    const { t } = useTranslation();
    const activeTab = tabs.find((tab) => tab.key === activeTabKey);

    return (
        <section className="WebSSH-Home-Content">
            <header className="WebSSH-Home-ContentHeader">
                {activeTab ? (
                    <>
                        <span className="WebSSH-Home-ContentIcon">
                            {getTabIcon(activeTab.path)}
                        </span>
                        <span className="WebSSH-Home-ContentTitle">
                            {activeTab.label}
                        </span>
                    </>
                ) : (
                    <span className="WebSSH-Home-ContentTitle">
                        {t("app_tab_new")}
                    </span>
                )}
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
