import type { ITarget } from "@/api";

export default function getTargetName(target: ITarget): string {
    return (
        target.name ||
        `${target.user}@${target.host}${target.port ? `:${target.port}` : ""}`
    );
}
