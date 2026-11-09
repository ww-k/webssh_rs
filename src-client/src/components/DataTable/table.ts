import {
    createCoreRowModel,
    createExpandedRowModel,
    createSortedRowModel,
    rowExpandingFeature,
    rowSelectionFeature,
    rowSortingFeature,
    tableFeatures,
} from "@tanstack/react-table";

export const features = tableFeatures({
    rowSelectionFeature,
    rowExpandingFeature,
    rowSortingFeature,
    coreRowModel: createCoreRowModel(),
    sortedRowModel: createSortedRowModel(),
    expandedRowModel: createExpandedRowModel(),
});
