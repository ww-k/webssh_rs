import type { ITab } from "@/store";

export function isSplitNode(node: ITab) {
    return Boolean(node.child1 || node.child2);
}

export function getFirstView(node: ITab): ITab {
    const child = node.child1 ?? node.child2;
    return child ? getFirstView(child) : node;
}

export function getActiveView(root: ITab): ITab {
    return (
        findNode(root, root.activeChildKey ?? root.key) ?? getFirstView(root)
    );
}

export function findNode(node: ITab, key: string): ITab | undefined {
    if (node.key === key) return node;
    for (const child of [node.child1, node.child2]) {
        if (!child) continue;
        const found = findNode(child, key);
        if (found) return found;
    }
    return undefined;
}
