import { cn } from "@/lib/utils";

/**
 * Table shell classes used on `<Table>` for dense bordered rows.
 * `border-separate` keeps sticky column edges visible when horizontally scrolled.
 */
export const dataTableShellClassName =
  "border-separate border-spacing-0 [&_thead_tr_th]:border-b [&_thead_tr_th]:border-border [&_tbody_tr_td]:border-b [&_tbody_tr_td]:border-border [&_tbody_tr:last-child_td]:border-b-0";

/**
 * Outline icon buttons in a sticky Actions column.
 * Uses `group/btn` so it does not clash with `group/row` on `TableRow`.
 */
export const dataTableActionIconButtonClassName =
  "group/btn text-muted-foreground shadow-xs not-disabled:hover:!border-emerald-600 not-disabled:hover:!bg-emerald-600 not-disabled:hover:!text-white not-disabled:hover:shadow-sm focus-visible:ring-emerald-500/90 dark:not-disabled:hover:!bg-emerald-600";

/**
 * Primary emerald CTA style (e.g. “Draft email” in vendor workflows).
 */
export const dataTableEmeraldPrimaryButtonClassName =
  "gap-1.5 bg-emerald-600 font-semibold text-white shadow-sm hover:bg-emerald-100 hover:text-black focus-visible:ring-emerald-500/90 dark:bg-emerald-600 dark:hover:bg-emerald-200 dark:hover:text-black";

/** Sticky Actions column: right edge + optional stacked shadow when table is scrolled. */
export function dataTableStickyActionsEdgeClassName(stacked: boolean): string {
  return stacked
    ? "border-l-[1pt] border-border pl-3 shadow-[inset_1pt_0_0_0_hsl(var(--border)),inset_1px_0_0_0_rgba(0,0,0,0.06),-10px_0_20px_-6px_rgba(0,0,0,0.1),-4px_0_8px_-2px_rgba(0,0,0,0.06)] dark:shadow-[inset_1pt_0_0_0_hsl(var(--border)),inset_1px_0_0_0_rgba(255,255,255,0.06),-12px_0_24px_-6px_rgba(0,0,0,0.55),-4px_0_10px_-2px_rgba(0,0,0,0.35)]"
    : "border-l-[1pt] border-border pl-3 shadow-[inset_1pt_0_0_0_hsl(var(--border))]";
}

export function dataTableStickyActionsHeadClassName(stacked: boolean): string {
  return cn(
    "sticky right-0 z-20 min-w-[6.75rem] bg-background text-right",
    dataTableStickyActionsEdgeClassName(stacked),
  );
}

/** Opaque hover fill so stacked sticky Actions cells do not show scrolled content behind. */
export function dataTableStickyActionsCellClassName(stacked: boolean): string {
  return cn(
    "sticky right-0 z-10 min-w-[6.75rem] bg-background text-right group-hover/row:bg-muted",
    dataTableStickyActionsEdgeClassName(stacked),
  );
}
