"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  ChevronRight,
  Clock,
  ExternalLink,
  FlaskConical,
  ThumbsUp,
} from "lucide-react";
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
import { KognitosRunsAnalyzedTable } from "@/components/kognitos/kognitos-runs-analyzed-table";
import { vendorProfileHref } from "@/lib/vendors/vendor-path";
import {
  type DashboardRunSortKey,
  type KognitosDashboardRun,
  type PeriodFilter,
  filterRunsByPeriod,
  runMeetsTotalApprovedPaymentsRequirements,
  sortDashboardRunsForDisplay,
  sortKognitosDashboardRunsByColumn,
} from "@/lib/kognitos/normalize-dashboard-run";
import { cn } from "@/lib/utils";

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type HealthSeg = {
  key: string;
  label: string;
  count: number;
  barClass: string;
  dotClass: string;
};

function buildValidationHealth(runs: KognitosDashboardRun[]): HealthSeg[] {
  const pending = runs.filter(
    (r) => !runMeetsTotalApprovedPaymentsRequirements(r),
  );
  const processed = runs.filter(runMeetsTotalApprovedPaymentsRequirements)
    .length;
  return [
    {
      key: "processed",
      label: "Processed payment",
      count: processed,
      barClass: "bg-emerald-400",
      dotClass: "bg-emerald-400",
    },
    {
      key: "doc",
      label: "DOC — Pending due to Document Mismatch",
      count: pending.filter((r) => !r.docOk).length,
      barClass: "bg-slate-400 dark:bg-slate-500",
      dotClass: "bg-slate-400",
    },
    {
      key: "qty",
      label: "QTY — Pending due to Quantity and Unit Mismatch",
      count: pending.filter((r) => !r.qtyOk).length,
      barClass: "bg-slate-400 dark:bg-slate-500",
      dotClass: "bg-slate-400",
    },
    {
      key: "val",
      label: "VAL — Pending due to Value Mismatch",
      count: pending.filter((r) => !r.valOk).length,
      barClass: "bg-emerald-600",
      dotClass: "bg-emerald-600",
    },
    {
      key: "coa",
      label: "COA — Pending due to COA Validation",
      count: pending.filter((r) => !r.coaOk).length,
      barClass: "bg-emerald-800",
      dotClass: "bg-emerald-800",
    },
  ];
}

export function KognitosRunsDashboard() {
  const [period, setPeriod] = useState<PeriodFilter>("all");
  const [tab, setTab] = useState<"pending" | "processed" | "all">("pending");
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [expertQueueBannerDismissed, setExpertQueueBannerDismissed] =
    useState(false);
  const [expertQueueCount, setExpertQueueCount] = useState<number | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [runSort, setRunSort] = useState<{
    key: DashboardRunSortKey;
    dir: "asc" | "desc";
  } | null>(null);

  const [runs, setRuns] = useState<KognitosDashboardRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/kognitos/runs");
      const json = (await res.json()) as {
        runs?: KognitosDashboardRun[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? `Failed to load runs (${res.status})`);
        setRuns([]);
        return;
      }
      setRuns(json.runs ?? []);
    } catch {
      setError("Could not load Kognitos runs.");
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadExpertQueueCount = useCallback(async () => {
    try {
      const res = await fetch("/api/kognitos/expert-queue");
      const json = (await res.json()) as { items?: unknown[] };
      if (!res.ok) {
        setExpertQueueCount(0);
        return;
      }
      setExpertQueueCount(json.items?.length ?? 0);
    } catch {
      setExpertQueueCount(0);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    void loadExpertQueueCount();
  }, [loadExpertQueueCount]);

  useEffect(() => {
    const handler = () => {
      void loadRuns();
      void loadExpertQueueCount();
    };
    window.addEventListener("chat-data-changed", handler);
    return () => window.removeEventListener("chat-data-changed", handler);
  }, [loadRuns, loadExpertQueueCount]);

  const periodRuns = useMemo(
    () => filterRunsByPeriod(runs, period),
    [runs, period],
  );

  const vendorOptions = useMemo(() => {
    const set = new Set(periodRuns.map((r) => r.vendor));
    return ["all", ...[...set].sort((a, b) => a.localeCompare(b))];
  }, [periodRuns]);

  const kpis = useMemo(() => {
    const processed = periodRuns.filter(runMeetsTotalApprovedPaymentsRequirements);
    const pending = periodRuns.filter(
      (r) => !runMeetsTotalApprovedPaymentsRequirements(r),
    );
    const pendingTotal = pending.reduce((s, r) => s + r.value, 0);
    const approvedTotal = processed.reduce((s, r) => s + r.value, 0);

    const byVendor = new Map<string, { count: number; sum: number }>();
    for (const r of periodRuns) {
      const cur = byVendor.get(r.vendor) ?? { count: 0, sum: 0 };
      cur.count += 1;
      cur.sum += r.value;
      byVendor.set(r.vendor, cur);
    }
    let topVendor = { name: "—", count: 0, sum: 0 };
    for (const [name, v] of byVendor) {
      if (v.count > topVendor.count) topVendor = { name, ...v };
    }

    const byLine = new Map<string, number>();
    for (const r of periodRuns) {
      const k = r.lineItem?.trim() || r.invoiceNumber;
      byLine.set(k, (byLine.get(k) ?? 0) + 1);
    }
    let topLine = { title: "—", count: 0 };
    for (const [title, count] of byLine) {
      if (count > topLine.count) topLine = { title, count };
    }

    return {
      pendingTotal,
      pendingCount: pending.length,
      approvedTotal,
      processedCount: processed.length,
      topVendor,
      topLine,
    };
  }, [periodRuns]);

  const validationSegments = useMemo(
    () => buildValidationHealth(periodRuns),
    [periodRuns],
  );

  const healthTotal = validationSegments.reduce((s, x) => s + x.count, 0);

  const tabFiltered = useMemo(() => {
    if (tab === "all") return periodRuns;
    return periodRuns.filter((r) => r.pipeline === tab);
  }, [periodRuns, tab]);

  const runsForTabCounts = useMemo(() => {
    if (vendorFilter === "all") return periodRuns;
    return periodRuns.filter((r) => r.vendor === vendorFilter);
  }, [periodRuns, vendorFilter]);

  const tabCounts = useMemo(
    () => ({
      pending: runsForTabCounts.filter((r) => r.pipeline === "pending").length,
      processed: runsForTabCounts.filter((r) => r.pipeline === "processed")
        .length,
      all: runsForTabCounts.length,
    }),
    [runsForTabCounts],
  );

  const tableRows = useMemo(() => {
    const filtered =
      vendorFilter === "all"
        ? tabFiltered
        : tabFiltered.filter((r) => r.vendor === vendorFilter);
    return sortDashboardRunsForDisplay(filtered);
  }, [tabFiltered, vendorFilter]);

  const sortedTableRows = useMemo(
    () => sortKognitosDashboardRunsByColumn(tableRows, runSort),
    [tableRows, runSort],
  );

  const handleSortColumn = useCallback((key: DashboardRunSortKey) => {
    setRunSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
    setPageIndex(0);
  }, []);

  const pageCount = Math.max(1, Math.ceil(sortedTableRows.length / pageSize));
  const safePage = Math.min(pageIndex, pageCount - 1);
  const pageStart = safePage * pageSize;
  const pageSlice = sortedTableRows.slice(pageStart, pageStart + pageSize);
  const rangeStart = sortedTableRows.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + pageSize, sortedTableRows.length);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(sortedTableRows.length / pageSize) - 1);
    setPageIndex((i) => (i > maxPage ? maxPage : i));
  }, [sortedTableRows.length, pageSize]);

  return (
    <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">
              Validation health and triage from stored Kognitos runs for the
              selected period.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-sm text-muted-foreground">Period</span>
            <Select
              value={period}
              onValueChange={(v) => {
                setPeriod(v as PeriodFilter);
                setRunSort(null);
                setPageIndex(0);
              }}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {!expertQueueBannerDismissed ? (
          <div
            className={cn(
              "rounded-lg border border-border bg-white py-5 pl-5 pr-4 shadow-sm",
              "dark:border-border dark:bg-card",
            )}
          >
            <p className="font-semibold text-foreground">
              Expert Queue -{" "}
              {expertQueueCount === null ? (
                <span className="font-normal text-muted-foreground">
                  loading…
                </span>
              ) : (
                <>
                  {expertQueueCount}{" "}
                  {expertQueueCount === 1 ? "item" : "items"} pending
                </>
              )}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Same list as the Expert Queue page: runs that need review and
              resolution.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                asChild
              >
                <Link href="/expert-queue" className="inline-flex items-center gap-2">
                  Open Expert Queue
                  <ExternalLink className="size-4" />
                </Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-border bg-white hover:bg-muted/50 dark:bg-transparent dark:hover:bg-muted/40"
                onClick={() => setExpertQueueBannerDismissed(true)}
              >
                Mark as Read
              </Button>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="gap-4 py-5">
            <CardContent className="flex items-start justify-between px-5">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">
                  Total Pending Payments
                </p>
                <p className="text-2xl font-bold tracking-tight">
                  {currencyFmt.format(kpis.pendingTotal)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {kpis.pendingCount} pending runs
                </p>
              </div>
              <div className="rounded-md bg-amber-500/15 p-2.5 text-amber-600 dark:text-amber-400">
                <Clock className="size-5" />
              </div>
            </CardContent>
          </Card>
          <Card className="gap-4 py-5">
            <CardContent className="flex items-start justify-between px-5">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">
                  Total Approved Payments
                </p>
                <p className="text-2xl font-bold tracking-tight">
                  {currencyFmt.format(kpis.approvedTotal)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {kpis.processedCount} processed runs
                </p>
              </div>
              <div className="rounded-md bg-amber-500/15 p-2.5 text-amber-600 dark:text-amber-400">
                <ThumbsUp className="size-5" />
              </div>
            </CardContent>
          </Card>
          <Card className="gap-4 py-5">
            <CardContent className="flex items-start justify-between px-5">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">
                  Top Vendor
                </p>
                <p className="line-clamp-2 text-lg font-bold leading-snug tracking-tight">
                  {kpis.topVendor.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {kpis.topVendor.count} runs ·{" "}
                  {currencyFmt.format(kpis.topVendor.sum)} total value
                </p>
              </div>
              <div className="rounded-md bg-amber-500/15 p-2.5 text-amber-600 dark:text-amber-400">
                <Building2 className="size-5" />
              </div>
            </CardContent>
          </Card>
          <Card className="gap-4 py-5">
            <CardContent className="flex items-start justify-between px-5">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">
                  Top line item
                </p>
                <p className="line-clamp-2 text-lg font-bold leading-snug tracking-tight">
                  {kpis.topLine.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {kpis.topLine.count} runs (from user inputs)
                </p>
              </div>
              <div className="rounded-md bg-amber-500/15 p-2.5 text-amber-600 dark:text-amber-400">
                <FlaskConical className="size-5" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden shadow-sm">
          <CardHeader className="flex flex-col gap-3 border-b px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle>Validation health</CardTitle>
              <CardDescription>
                Aggregated from run pipeline and per-step checks on pending runs.
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="h-auto shrink-0 gap-0.5 px-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 hover:text-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-100"
            >
              <Link href="/expert-queue" className="inline-flex items-center gap-0.5">
                View issues
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 border-b px-6 pb-6">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
              {validationSegments.map((seg) =>
                seg.count === 0 ? null : (
                  <div
                    key={seg.key}
                    className={cn("h-full transition-all", seg.barClass)}
                    style={{
                      width: `${(seg.count / Math.max(healthTotal, 1)) * 100}%`,
                    }}
                    title={`${seg.label}: ${seg.count}`}
                  />
                ),
              )}
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
              {validationSegments.map((seg) => (
                <li key={seg.key} className="flex items-center gap-1.5">
                  <span
                    className={cn("size-2 shrink-0 rounded-full", seg.dotClass)}
                  />
                  <span>
                    {seg.label.includes("—")
                      ? seg.label.split("—")[0]?.trim()
                      : seg.label}{" "}
                    ({seg.count})
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>

          <KognitosRunsAnalyzedTable
          surface="plain"
          loading={loading}
          tab={tab}
          onTabChange={(t) => {
            setTab(t);
            setRunSort(null);
            setPageIndex(0);
          }}
          tabCounts={tabCounts}
          vendorFilter={vendorFilter}
          onVendorFilterChange={(v) => {
            setVendorFilter(v);
            setRunSort(null);
            setPageIndex(0);
          }}
          vendorOptions={vendorOptions}
          vendorNameHref={vendorProfileHref}
          sortKey={runSort?.key ?? null}
          sortDir={runSort?.dir}
          onSortColumn={handleSortColumn}
          pageSlice={pageSlice}
          safePage={safePage}
          pageCount={pageCount}
          pageSize={pageSize}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPageIndex(0);
          }}
          onPagePrev={() => setPageIndex(safePage - 1)}
          onPageNext={() => setPageIndex(safePage + 1)}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          totalRowCount={sortedTableRows.length}
          description="Review and manage analyzed invoice runs."
        />
        </Card>
    </div>
  );
}
