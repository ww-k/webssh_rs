import type { ITab } from "@/store";
export default function Terminal({ tab }: { tab: ITab }) {
    return (
        <div>
            <div id="terminal">terminal {tab.path}</div>
        </div>
    );
}
