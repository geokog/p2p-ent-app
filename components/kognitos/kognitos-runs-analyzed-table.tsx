"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  Check,
  Eye,
  Mail,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  DashboardRunSortKey,
  KognitosDashboardRun,
} from "@/lib/kognitos/normalize-dashboard-run";
import { cn } from "@/lib/utils";

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Primary table copy: light weight, even color (Apple-like vs heavy black/bold). */
const cellPrimary =
  "align-top text-[15px] font-normal leading-snug tracking-[-0.01em] text-foreground";
const cellTabular = cn(cellPrimary, "tabular-nums");

export type RunsAnalyzedTab = "pending" | "processed" | "all";

export type RunsAnalyzedSortKey = DashboardRunSortKey;

function CheckCell({ ok }: { ok: boolean }) {
  return (
    <TableCell className="px-1 text-center" aria-label={ok ? "Pass" : "Fail"}>
      {ok ? (
        <span
          className={cn(
            "mx-auto flex size-7 items-center justify-center rounded-full border",
            "border-emerald-200/80 bg-emerald-50/90 text-emerald-600",
            "dark:border-emerald-800/50 dark:bg-emerald-950/35 dark:text-emerald-400/90",
          )}
        >
          <Check className="size-3.5 stroke-[2]" aria-hidden />
        </span>
      ) : (
        <span
          className={cn(
            "mx-auto flex size-7 items-center justify-center rounded-full border",
            "border-rose-200/80 bg-rose-50/90 text-rose-600",
            "dark:border-rose-900/45 dark:bg-rose-950/30 dark:text-rose-400/90",
          )}
        >
          <X className="size-3.5 stroke-[2]" aria-hidden />
        </span>
      )}
    </TableCell>
  );
}

function MiniHeader({ code, title }: { code: string; title: string }) {
  return (
    <TableHead className="w-10 min-w-10 bg-muted/70 px-1 text-center text-xs font-semibold text-muted-foreground">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help tracking-tight">{code}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          {title}
        </TooltipContent>
      </Tooltip>
    </TableHead>
  );
}

function SortableHead({
  label,
  colKey,
  sortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string;
  colKey: DashboardRunSortKey;
  sortKey: DashboardRunSortKey | null | undefined;
  sortDir: "asc" | "desc" | undefined;
  onSort?: (key: DashboardRunSortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === colKey;
  const Icon =
    !active || !sortDir
      ? ArrowUpDown
      : sortDir === "asc"
        ? ArrowUp
        : ArrowDown;

  const headLabel =
    "bg-muted/70 text-xs font-medium uppercase tracking-wide text-muted-foreground";

  if (!onSort) {
    return (
      <TableHead
        className={cn(headLabel, align === "right" && "text-right")}
      >
        {label}
      </TableHead>
    );
  }

  return (
    <TableHead className={cn(headLabel, align === "right" && "text-right")}>
      <button
        type="button"
        onClick={() => onSort(colKey)}
        className={cn(
          "items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground",
          align === "right" ? "flex w-full justify-end" : "inline-flex",
        )}
      >
        {label}
        <Icon
          className={cn(
            "size-3 shrink-0 opacity-40",
            active && "opacity-80 text-foreground",
          )}
          aria-hidden
        />
      </button>
    </TableHead>
  );
}

export type KognitosRunsAnalyzedTableProps = {
  title?: string;
  description?: string;
  loading: boolean;
  tab: RunsAnalyzedTab;
  onTabChange: (t: RunsAnalyzedTab) => void;
  /** Counts for Pending / Processed / All badges (scoped same as table data). */
  tabCounts?: { pending: number; processed: number; all: number };
  showVendorSelect?: boolean;
  vendorFilter: string;
  onVendorFilterChange: (v: string) => void;
  vendorOptions: string[];
  /** Wrap vendor name in a link when this returns a URL. */
  vendorNameHref?: (vendor: string) => string | null;
  sortKey?: DashboardRunSortKey | null;
  sortDir?: "asc" | "desc";
  onSortColumn?: (key: DashboardRunSortKey) => void;
  pageSlice: KognitosDashboardRun[];
  pageCount: number;
  safePage: number;
  pageSize: number;
  onPageSizeChange: (n: number) => void;
  onPagePrev: () => void;
  onPageNext: () => void;
  rangeStart: number;
  rangeEnd: number;
  totalRowCount: number;
  /**
   * `plain`: no outer `Card` — use inside a parent card (e.g. validation health + runs).
   * @default "card"
   */
  surface?: "card" | "plain";
};

export function KognitosRunsAnalyzedTable({
  title = "Runs analyzed",
  description,
  loading,
  tab,
  onTabChange,
  tabCounts,
  showVendorSelect = true,
  vendorFilter,
  onVendorFilterChange,
  vendorOptions,
  vendorNameHref,
  sortKey,
  sortDir,
  onSortColumn,
  pageSlice,
  safePage,
  pageCount,
  pageSize,
  onPageSizeChange,
  onPagePrev,
  onPageNext,
  rangeStart,
  rangeEnd,
  totalRowCount,
  surface = "card",
}: KognitosRunsAnalyzedTableProps) {
  const [invoicePdfOpen, setInvoicePdfOpen] = useState(false);
  const [invoicePdfSrc, setInvoicePdfSrc] = useState<string | null>(null);
  const embedded = surface === "plain";

  const main = (
        <Tabs
          value={tab}
          onValueChange={(v) => {
            onTabChange(v as RunsAnalyzedTab);
          }}
          className="gap-0"
        >
          <CardHeader
            className={cn(
              "space-y-4 border-b px-6 py-4",
              embedded && "border-t",
            )}
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <TabsList className="h-auto gap-2 bg-transparent p-0">
                <TabsTrigger
                  value="pending"
                  className={cn(
                    "gap-2 rounded-lg border border-border bg-background px-3 py-2 shadow-none",
                    "data-[state=active]:border-emerald-200 data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-950",
                    "dark:data-[state=active]:border-emerald-800 dark:data-[state=active]:bg-emerald-950/40 dark:data-[state=active]:text-emerald-50",
                  )}
                >
                  Pending
                  {tabCounts != null ? (
                    <Badge
                      variant="outline"
                      className="rounded-full border-emerald-200/80 bg-emerald-100/80 px-2 font-semibold text-emerald-900 tabular-nums dark:border-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-100"
                    >
                      {tabCounts.pending}
                    </Badge>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger
                  value="processed"
                  className={cn(
                    "gap-2 rounded-lg border border-border bg-background px-3 py-2 shadow-none",
                    "data-[state=active]:border-emerald-200 data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-950",
                    "dark:data-[state=active]:border-emerald-800 dark:data-[state=active]:bg-emerald-950/40 dark:data-[state=active]:text-emerald-50",
                  )}
                >
                  Processed
                  {tabCounts != null ? (
                    <Badge
                      variant="outline"
                      className="rounded-full border-emerald-200/80 bg-emerald-100/80 px-2 font-semibold text-emerald-900 tabular-nums dark:border-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-100"
                    >
                      {tabCounts.processed}
                    </Badge>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger
                  value="all"
                  className={cn(
                    "gap-2 rounded-lg border border-border bg-background px-3 py-2 shadow-none",
                    "data-[state=active]:border-emerald-200 data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-950",
                    "dark:data-[state=active]:border-emerald-800 dark:data-[state=active]:bg-emerald-950/40 dark:data-[state=active]:text-emerald-50",
                  )}
                >
                  All
                  {tabCounts != null ? (
                    <Badge
                      variant="outline"
                      className="rounded-full border-emerald-200/80 bg-emerald-100/80 px-2 font-semibold text-emerald-900 tabular-nums dark:border-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-100"
                    >
                      {tabCounts.all}
                    </Badge>
                  ) : null}
                </TabsTrigger>
              </TabsList>
              {showVendorSelect ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Vendor</span>
                  <Select
                    value={vendorFilter}
                    onValueChange={onVendorFilterChange}
                  >
                    <SelectTrigger className="w-[200px] lg:w-[240px]">
                      <SelectValue placeholder="Vendor" />
                    </SelectTrigger>
                    <SelectContent>
                      {vendorOptions.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v === "all" ? "All vendors" : v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
            <div>
              <CardTitle className="text-lg font-medium tracking-tight text-foreground">
                {title}
              </CardTitle>
              {description ? (
                <CardDescription className="pt-1 text-sm">
                  {description}
                </CardDescription>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-0 px-0 pb-4">
            {(["pending", "processed", "all"] as const).map((t) => (
              <TabsContent key={t} value={t} className="mt-0 space-y-0">
                <div
                  className={cn(
                    "overflow-hidden rounded-lg border border-border bg-background",
                    embedded ? "mx-6" : "mx-4",
                  )}
                >
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b border-border hover:bg-transparent">
                        <SortableHead
                          label="Vendor"
                          colKey="vendor"
                          sortKey={sortKey}
                          sortDir={sortDir}
                          onSort={onSortColumn}
                        />
                        <SortableHead
                          label="Invoice / ID"
                          colKey="invoice"
                          sortKey={sortKey}
                          sortDir={sortDir}
                          onSort={onSortColumn}
                        />
                        <SortableHead
                          label="Value"
                          colKey="value"
                          sortKey={sortKey}
                          sortDir={sortDir}
                          onSort={onSortColumn}
                          align="right"
                        />
                        <MiniHeader code="DOC" title="Document validation" />
                        <MiniHeader
                          code="QTY"
                          title="Quantity and unit validation"
                        />
                        <MiniHeader code="VAL" title="Value validation" />
                        <MiniHeader code="COA" title="COA validation" />
                        <MiniHeader code="PAY" title="Payment release" />
                        <SortableHead
                          label="Completed"
                          colKey="completed"
                          sortKey={sortKey}
                          sortDir={sortDir}
                          onSort={onSortColumn}
                        />
                        <TableHead className="bg-muted/70 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Actions
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell
                            colSpan={10}
                            className="h-24 text-center text-muted-foreground"
                          >
                            Loading runs…
                          </TableCell>
                        </TableRow>
                      ) : pageSlice.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={10}
                            className="h-24 text-center text-muted-foreground"
                          >
                            No runs for this view. Sync from Kognitos or check
                            your filters.
                          </TableCell>
                        </TableRow>
                      ) : (
                        pageSlice.map((row) => {
                          const vendorHref =
                            vendorNameHref?.(row.vendor) ?? null;
                          const runUrl = row.kognitosRunUrl?.trim() || null;
                          return (
                            <TableRow
                              key={row.id}
                              className="border-b border-border/70 last:border-0 hover:bg-muted/20"
                            >
                              <TableCell className={cn("max-w-[240px]", cellPrimary)}>
                                <div className="flex items-start gap-2.5">
                                  <span
                                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100/90 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                                    aria-hidden
                                  >
                                    <RefreshCw className="size-3.5" />
                                  </span>
                                  <div className="min-w-0 pt-0.5">
                                    {vendorHref ? (
                                      <Link
                                        href={vendorHref}
                                        className={cn(
                                          "text-foreground underline-offset-4 hover:underline",
                                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
                                        )}
                                      >
                                        {row.vendor}
                                      </Link>
                                    ) : (
                                      row.vendor
                                    )}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className={cellTabular}>
                                {row.invoicePdfUrl ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setInvoicePdfSrc(row.invoicePdfUrl);
                                      setInvoicePdfOpen(true);
                                    }}
                                    className={cn(
                                      "text-left text-foreground underline-offset-4 hover:underline",
                                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
                                    )}
                                    aria-label="Open supplier invoice PDF"
                                  >
                                    {row.invoiceNumber}
                                  </button>
                                ) : (
                                  row.invoiceNumber
                                )}
                              </TableCell>
                              <TableCell
                                className={cn(cellTabular, "text-right")}
                              >
                                {currencyFmt.format(row.value)}
                              </TableCell>
                              <CheckCell ok={row.docOk} />
                              <CheckCell ok={row.qtyOk} />
                              <CheckCell ok={row.valOk} />
                              <CheckCell ok={row.coaOk} />
                              <CheckCell ok={row.payOk} />
                              <TableCell className="align-top text-sm tabular-nums text-muted-foreground">
                                {row.completedAt ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <Calendar
                                      className="size-3.5 shrink-0 opacity-70"
                                      aria-hidden
                                    />
                                    {format(
                                      new Date(row.completedAt),
                                      "MMM d, yyyy, h:mm a",
                                    )}
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-0.5">
                                  {runUrl ? (
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="outline"
                                      className="size-8 rounded-full border-border"
                                      asChild
                                      aria-label="View run results in Kognitos (opens in new tab)"
                                    >
                                      <a
                                        href={runUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        <Eye className="size-4" />
                                      </a>
                                    </Button>
                                  ) : (
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="outline"
                                      className="size-8 rounded-full"
                                      disabled
                                      aria-label="Kognitos run link unavailable"
                                    >
                                      <Eye className="size-4" />
                                    </Button>
                                  )}
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="outline"
                                    className="size-8 rounded-full"
                                    aria-label="Message (placeholder)"
                                    disabled
                                  >
                                    <Mail className="size-4" />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="outline"
                                    className="size-8 rounded-full"
                                    aria-label="Run in Kognitos (placeholder)"
                                    disabled
                                  >
                                    <Play className="size-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            ))}

            <div
              className={cn(
                "flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between",
                embedded ? "px-6" : "px-4",
              )}
            >
              <p className="text-sm text-muted-foreground">
                Showing {rangeStart}–{rangeEnd} of {totalRowCount}{" "}
                {totalRowCount === 1 ? "run" : "runs"}
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Rows per page
                  </span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      onPageSizeChange(Number(v));
                    }}
                  >
                    <SelectTrigger size="sm" className="w-[70px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 25, 50].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safePage <= 0}
                    onClick={onPagePrev}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safePage >= pageCount - 1}
                    onClick={onPageNext}
                    className={cn(
                      safePage < pageCount - 1 &&
                        "border-emerald-600 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-500 dark:text-emerald-100 dark:hover:bg-emerald-950/40",
                    )}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Tabs>
  );

  return (
    <TooltipProvider delayDuration={200}>
      {embedded ? (
        <div className="space-y-0">{main}</div>
      ) : (
        <Card className="gap-0 overflow-hidden py-0 shadow-sm">{main}</Card>
      )}
      <Dialog
        open={invoicePdfOpen}
        onOpenChange={(open) => {
          setInvoicePdfOpen(open);
          if (!open) setInvoicePdfSrc(null);
        }}
      >
        <DialogContent
          showCloseButton
          className="flex h-[min(86vh,820px)] w-[min(96vw,56rem)] max-w-[min(96vw,56rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,56rem)]"
        >
          <DialogHeader className="shrink-0 border-b px-4 py-3 text-left">
            <DialogTitle>Supplier invoice</DialogTitle>
            <DialogDescription>
              PDF from the automation file input (streamed from Kognitos).
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 bg-muted">
            {invoicePdfSrc ? (
              <iframe
                title="Supplier invoice PDF"
                src={invoicePdfSrc}
                className="size-full min-h-[400px] border-0"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
