import { useCallback, useRef } from "react";

const TABLE_SCROLL_CONTAINER_SELECTOR =
    ".ant-table-tbody-virtual-holder, .ant-table-body";

export default function useTablePageNavigation() {
    const tableContainerRef = useRef<HTMLDivElement>(null);

    const handleKeyDownCapture = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
            if (
                event.key !== "PageUp" &&
                event.key !== "PageDown" &&
                event.key !== "Home" &&
                event.key !== "End"
            ) {
                return;
            }

            const scrollContainer =
                event.currentTarget.querySelector<HTMLElement>(
                    TABLE_SCROLL_CONTAINER_SELECTOR,
                );
            if (!scrollContainer) return;

            event.preventDefault();
            if (event.key === "Home") {
                scrollContainer.scrollTop = 0;
                return;
            }
            if (event.key === "End") {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
                return;
            }

            const offset = scrollContainer.clientHeight;
            scrollContainer.scrollTop +=
                event.key === "PageDown" ? offset : -offset;
        },
        [],
    );

    const focusTable = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            // DataTable manages its own focus so its selected-row focus styles remain active.
            if ((event.target as HTMLElement).closest(".WebSSH-DataTable")) {
                return;
            }
            tableContainerRef.current?.focus();
        },
        [],
    );

    return {
        tableContainerRef,
        tablePageNavigationProps: {
            tabIndex: 0,
            onClick: focusTable,
            onKeyDownCapture: handleKeyDownCapture,
        },
    };
}
