import "./Selector.css";

import TargetList from "./List";

import type { ITab } from "@/store";

export default function TargetSelector({
    active = true,
    tab,
}: {
    active?: boolean;
    tab: ITab;
}) {
    return (
        <main
            className="WebSSH-MenuPage WebSSH-TargetSelector"
            style={{ display: active ? undefined : "none" }}
        >
            <TargetList tab={tab} />
        </main>
    );
}
