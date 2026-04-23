"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  Check,
  ExternalLink,
  Mail,
  MoreHorizontal,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { InvoicePdfHighlightViewer } from "@/components/kognitos/invoice-pdf-highlight-viewer";
import { KognitosRunResultsDialog } from "@/components/kognitos/kognitos-run-results-dialog";
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

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

function FourWayMatchPill({ code, ok }: { code: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/35 px-3 py-2.5">
      <span className="text-sm font-medium text-muted-foreground">{code}</span>
      <span className="text-sm font-semibold text-foreground">
        {ok ? "Pass" : "Fail"}
      </span>
    </div>
  );
}

/** Same primary + hover for both CTAs; ghost variant avoids default `Button` primary hover fighting these colors. */
const reanalyzeCtaClass =
  "h-9 gap-2 rounded-md border-0 bg-[#2E966C] px-4 text-sm font-medium text-white shadow-none " +
  "transition-colors hover:bg-[#27805f] hover:text-white active:bg-[#236350] active:text-white " +
  "focus-visible:ring-2 focus-visible:ring-[#2E966C] focus-visible:ring-offset-2 focus-visible:outline-none " +
  "cursor-pointer";

export type RunsAnalyzedTab = "pending" | "processed" | "all";

export type RunsAnalyzedSortKey = DashboardRunSortKey;

function validationExpectedActualTooltip(
  expectedCol: string | null,
  actualCol: string | null,
): ReactNode | undefined {
  if (expectedCol === null) return undefined;
  return (
    <div className="space-y-1.5 tabular-nums">
      <div>
        <span className="opacity-75">Expected: </span>
        <span className="font-medium">{expectedCol || "—"}</span>
      </div>
      <div>
        <span className="opacity-75">Actual: </span>
        <span className="font-medium">{actualCol || "—"}</span>
      </div>
    </div>
  );
}

function CheckCell({
  ok,
  code,
  onOpenResults,
  tooltip,
}: {
  ok: boolean;
  code: string;
  onOpenResults: () => void;
  /** Optional hover content (e.g. VAL expected vs actual). */
  tooltip?: ReactNode;
}) {
  const label = `${code}: ${ok ? "Pass" : "Fail"}`;
  const circle = ok
    ? cn(
        "border-emerald-200/80 bg-emerald-50/90 text-emerald-600",
        "dark:border-emerald-800/50 dark:bg-emerald-950/35 dark:text-emerald-400/90",
      )
    : cn(
        "border-rose-200/80 bg-rose-50/90 text-rose-600",
        "dark:border-rose-900/45 dark:bg-rose-950/30 dark:text-rose-400/90",
      );

  const button = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenResults();
      }}
      className={cn(
        "mx-auto flex size-7 items-center justify-center rounded-full border transition-opacity",
        "hover:opacity-90",
        "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        circle,
      )}
      aria-label={`${label}. Open run results report.`}
    >
      {ok ? (
        <Check className="size-3.5 stroke-[2]" aria-hidden />
      ) : (
        <X className="size-3.5 stroke-[2]" aria-hidden />
      )}
    </button>
  );

  return (
    <TableCell className="px-1 text-center">
      {tooltip != null ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent
            side="top"
            className="max-w-xs text-left text-xs leading-snug"
          >
            {tooltip}
          </TooltipContent>
        </Tooltip>
      ) : (
        button
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
  const [invoiceViewer, setInvoiceViewer] = useState<{
    pdfUrl: string;
    runId: string;
  } | null>(null);
  const [reanalyzeRun, setReanalyzeRun] = useState<KognitosDashboardRun | null>(
    null,
  );
  const [runResultsRow, setRunResultsRow] = useState<KognitosDashboardRun | null>(
    null,
  );
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
                                      const pdfUrl = row.invoicePdfUrl;
                                      if (!pdfUrl) return;
                                      setInvoiceViewer({
                                        pdfUrl,
                                        runId: row.id,
                                      });
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
                              <CheckCell
                                ok={row.docOk}
                                code="DOC"
                                onOpenResults={() => setRunResultsRow(row)}
                                tooltip={validationExpectedActualTooltip(
                                  row.docMatchExpected,
                                  row.docMatchActual,
                                )}
                              />
                              <CheckCell
                                ok={row.qtyOk}
                                code="QTY"
                                onOpenResults={() => setRunResultsRow(row)}
                                tooltip={validationExpectedActualTooltip(
                                  row.qtyMatchExpected,
                                  row.qtyMatchActual,
                                )}
                              />
                              <CheckCell
                                ok={row.valOk}
                                code="VAL"
                                onOpenResults={() => setRunResultsRow(row)}
                                tooltip={validationExpectedActualTooltip(
                                  row.valMatchExpected,
                                  row.valMatchActual,
                                )}
                              />
                              <CheckCell
                                ok={row.coaOk}
                                code="COA"
                                onOpenResults={() => setRunResultsRow(row)}
                                tooltip={validationExpectedActualTooltip(
                                  row.coaMatchExpected,
                                  row.coaMatchActual,
                                )}
                              />
                              <CheckCell
                                ok={row.payOk}
                                code="PAY"
                                onOpenResults={() => setRunResultsRow(row)}
                              />
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
                                <div className="flex justify-end items-center gap-1.5">
                                  {runUrl ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-8 gap-1.5 whitespace-nowrap rounded-full border-border bg-background px-3 font-normal shadow-none"
                                      asChild
                                    >
                                      <a
                                        href={runUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label="Open run in Kognitos (opens in new tab)"
                                      >
                                        Open run
                                        <ExternalLink
                                          className="size-3.5 shrink-0 opacity-70"
                                          aria-hidden
                                        />
                                      </a>
                                    </Button>
                                  ) : (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-8 gap-1.5 whitespace-nowrap rounded-full border-border bg-background px-3 font-normal shadow-none"
                                      disabled
                                      aria-label="Kognitos run link unavailable"
                                    >
                                      Open run
                                      <ExternalLink
                                        className="size-3.5 shrink-0 opacity-40"
                                        aria-hidden
                                      />
                                    </Button>
                                  )}
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="size-8 shrink-0 rounded-full border-border bg-background shadow-none"
                                        aria-label="More actions"
                                      >
                                        <MoreHorizontal
                                          className="size-4"
                                          aria-hidden
                                        />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" sideOffset={6}>
                                      <DropdownMenuItem
                                        disabled
                                        className="gap-2"
                                      >
                                        <Mail
                                          className="size-4 opacity-60"
                                          aria-hidden
                                        />
                                        Email supplier
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        className="gap-2"
                                        onSelect={() => setReanalyzeRun(row)}
                                      >
                                        <RefreshCw
                                          className="size-4 opacity-60"
                                          aria-hidden
                                        />
                                        Rerun automation
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
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
        open={reanalyzeRun != null}
        onOpenChange={(open) => {
          if (!open) setReanalyzeRun(null);
        }}
      >
        <DialogContent
          showCloseButton
          className="gap-0 overflow-hidden p-0 sm:max-w-[520px]"
        >
          {reanalyzeRun ? (
            <>
              <DialogHeader className="space-y-2 border-b px-6 py-5 text-left">
                <DialogTitle className="text-xl font-semibold tracking-tight">
                  Re-analyze in Kognitos
                </DialogTitle>
                <DialogDescription className="text-sm leading-relaxed">
                  Analysis summary for Invoice {reanalyzeRun.invoiceNumber} from{" "}
                  {reanalyzeRun.vendor}..
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-5 px-6 py-5">
                <div className="space-y-2">
                  <SectionLabel>Invoice</SectionLabel>
                  <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="text-xs text-muted-foreground">Vendor</p>
                        <p className="mt-0.5 text-sm font-semibold text-foreground">
                          {reanalyzeRun.vendor}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Invoice</p>
                        <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                          {reanalyzeRun.invoiceNumber}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 border-t border-border pt-4">
                      <p className="text-xs text-muted-foreground">Value</p>
                      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                        {currencyFmt.format(reanalyzeRun.value)}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <SectionLabel>4-way match</SectionLabel>
                  <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <FourWayMatchPill code="DOC" ok={reanalyzeRun.docOk} />
                      <FourWayMatchPill code="QTY" ok={reanalyzeRun.qtyOk} />
                      <FourWayMatchPill code="VAL" ok={reanalyzeRun.valOk} />
                      <FourWayMatchPill code="COA" ok={reanalyzeRun.coaOk} />
                      <FourWayMatchPill code="PAY" ok={reanalyzeRun.payOk} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t bg-muted/30 px-6 py-4">
                {reanalyzeRun.kognitosRunUrl?.trim() ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className={reanalyzeCtaClass}
                    asChild
                  >
                    <a
                      href={reanalyzeRun.kognitosRunUrl.trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center no-underline"
                    >
                      <Play className="size-4 fill-current" aria-hidden />
                      Analyze with same invoice
                    </a>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    className={reanalyzeCtaClass}
                  >
                    <Play className="size-4 fill-current" aria-hidden />
                    Analyze with same invoice
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className={reanalyzeCtaClass}
                >
                  <Play className="size-4 fill-current" aria-hidden />
                  Analyze with new invoice
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={invoiceViewer != null}
        onOpenChange={(open) => {
          if (!open) setInvoiceViewer(null);
        }}
      >
        <DialogContent
          centerFlex
          showCloseButton
          className="flex h-[min(90vh,880px)] w-[min(98vw,60rem)] max-w-[min(98vw,60rem)] flex-col gap-0 overflow-hidden border border-white/[0.08] bg-zinc-900 p-0 text-zinc-100 shadow-xl shadow-black/20 sm:max-w-[min(98vw,60rem)] [&_[data-slot=dialog-close]]:text-zinc-400 [&_[data-slot=dialog-close]]:hover:text-zinc-100"
        >
          <DialogHeader className="shrink-0 border-b border-white/[0.07] bg-zinc-900 px-4 py-2 text-left">
            <DialogTitle className="text-base font-medium text-zinc-50">
              Document Processing
            </DialogTitle>
          </DialogHeader>
          {invoiceViewer ? (
            <InvoicePdfHighlightViewer
              pdfUrl={invoiceViewer.pdfUrl}
              runId={invoiceViewer.runId}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <KognitosRunResultsDialog
        run={runResultsRow}
        open={runResultsRow != null}
        onOpenChange={(open) => {
          if (!open) setRunResultsRow(null);
        }}
      />
    </TooltipProvider>
  );
}
