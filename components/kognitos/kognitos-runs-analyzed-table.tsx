"use client";

import Link from "next/link";
import { format } from "date-fns";
import { Check, Eye, Mail, Play, X } from "lucide-react";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { KognitosDashboardRun } from "@/lib/kognitos/normalize-dashboard-run";
import { cn } from "@/lib/utils";

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export type RunsAnalyzedTab = "pending" | "processed" | "all";

function CheckCell({ ok }: { ok: boolean }) {
  return (
    <TableCell className="px-1 text-center">
      {ok ? (
        <Check
          className="mx-auto size-4 text-emerald-600 dark:text-emerald-400"
          aria-label="Pass"
        />
      ) : (
        <X className="mx-auto size-4 text-destructive" aria-label="Fail" />
      )}
    </TableCell>
  );
}

function MiniHeader({ code, title }: { code: string; title: string }) {
  return (
    <TableHead className="w-10 min-w-10 px-1 text-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help text-xs font-semibold tracking-tight">
            {code}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          {title}
        </TooltipContent>
      </Tooltip>
    </TableHead>
  );
}

export type KognitosRunsAnalyzedTableProps = {
  title?: string;
  description?: string;
  loading: boolean;
  tab: RunsAnalyzedTab;
  onTabChange: (t: RunsAnalyzedTab) => void;
  showVendorSelect?: boolean;
  vendorFilter: string;
  onVendorFilterChange: (v: string) => void;
  vendorOptions: string[];
  /** Wrap vendor name in a link when this returns a URL. */
  vendorNameHref?: (vendor: string) => string | null;
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
};

export function KognitosRunsAnalyzedTable({
  title = "Runs analyzed",
  description,
  loading,
  tab,
  onTabChange,
  showVendorSelect = true,
  vendorFilter,
  onVendorFilterChange,
  vendorOptions,
  vendorNameHref,
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
}: KognitosRunsAnalyzedTableProps) {
  return (
    <TooltipProvider delayDuration={200}>
    <Card className="gap-0 py-0">
      <Tabs
        value={tab}
        onValueChange={(v) => {
          onTabChange(v as RunsAnalyzedTab);
        }}
        className="gap-0"
      >
        <CardHeader className="border-b px-6 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <TabsList>
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="processed">Processed</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
            {showVendorSelect ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Vendor</span>
                <Select value={vendorFilter} onValueChange={onVendorFilterChange}>
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
          <CardTitle className="pt-2 text-base font-semibold">{title}</CardTitle>
          {description ? (
            <CardDescription className="pt-1">{description}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-0 px-0 pb-4">
          {(["pending", "processed", "all"] as const).map((t) => (
            <TabsContent key={t} value={t} className="mt-0 space-y-0">
              <div className="mx-4 rounded-lg border bg-background">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Vendor name</TableHead>
                      <TableHead>Invoice / ID</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <MiniHeader code="DOC" title="Document validation" />
                      <MiniHeader
                        code="QTY"
                        title="Quantity and unit validation"
                      />
                      <MiniHeader code="VAL" title="Value validation" />
                      <MiniHeader code="COA" title="COA validation" />
                      <MiniHeader code="PAY" title="Payment release" />
                      <TableHead>Completed</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
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
                          No runs for this view. Sync from Kognitos or check your
                          filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      pageSlice.map((row) => {
                        const vendorHref = vendorNameHref?.(row.vendor) ?? null;
                        const runUrl = row.kognitosRunUrl?.trim() || null;
                        return (
                          <TableRow key={row.id}>
                            <TableCell className="max-w-[200px] truncate font-medium">
                              {vendorHref ? (
                                <Link
                                  href={vendorHref}
                                  className={cn(
                                    "text-primary underline-offset-4 hover:underline",
                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
                                  )}
                                >
                                  {row.vendor}
                                </Link>
                              ) : (
                                row.vendor
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {row.invoiceNumber}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {currencyFmt.format(row.value)}
                            </TableCell>
                            <CheckCell ok={row.docOk} />
                            <CheckCell ok={row.qtyOk} />
                            <CheckCell ok={row.valOk} />
                            <CheckCell ok={row.coaOk} />
                            <CheckCell ok={row.payOk} />
                            <TableCell className="text-muted-foreground tabular-nums text-sm">
                              {row.completedAt
                                ? format(
                                    new Date(row.completedAt),
                                    "MMM d, yyyy, h:mm a",
                                  )
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-0.5">
                                {runUrl ? (
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="size-8"
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
                                    variant="ghost"
                                    className="size-8"
                                    disabled
                                    aria-label="Kognitos run link unavailable"
                                  >
                                    <Eye className="size-4" />
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="size-8"
                                  aria-label="Message (placeholder)"
                                  disabled
                                >
                                  <Mail className="size-4" />
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="size-8"
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

          <div className="flex flex-col gap-3 px-4 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {rangeStart}–{rangeEnd} of {totalRowCount}
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Rows</span>
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
              <div className="flex items-center gap-1">
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
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Tabs>
    </Card>
    </TooltipProvider>
  );
}
