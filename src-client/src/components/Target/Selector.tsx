import "./Selector.css";

import TargetList from "./List";

import type { ITab } from "@/store";

export default function TargetSelector({ tab }: { tab: ITab }) {
    return (
        <main className="WebSSH-MenuPage WebSSH-TargetSelector">
            <TargetList tab={tab} />
        </main>
    );
}
