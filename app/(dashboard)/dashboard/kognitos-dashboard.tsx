"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
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
  type KognitosDashboardRun,
  type PeriodFilter,
  filterRunsByPeriod,
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
  const pending = runs.filter((r) => r.pipeline === "pending");
  const processed = runs.filter((r) => r.pipeline === "processed").length;
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
  const [actionDismissed, setActionDismissed] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);

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

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    const handler = () => void loadRuns();
    window.addEventListener("chat-data-changed", handler);
    return () => window.removeEventListener("chat-data-changed", handler);
  }, [loadRuns]);

  const periodRuns = useMemo(
    () => filterRunsByPeriod(runs, period),
    [runs, period],
  );

  const actionAlert = useMemo(() => {
    const pendingValFail = periodRuns.filter(
      (r) => r.pipeline === "pending" && !r.valOk && r.vendor !== "—",
    );
    const byV = new Map<string, number>();
    for (const r of pendingValFail) {
      byV.set(r.vendor, (byV.get(r.vendor) ?? 0) + 1);
    }
    let best = { vendor: "", count: 0 };
    for (const [vendor, count] of byV) {
      if (count > best.count) best = { vendor, count };
    }
    return best.vendor ? best : null;
  }, [periodRuns]);

  const vendorOptions = useMemo(() => {
    const set = new Set(periodRuns.map((r) => r.vendor));
    return ["all", ...[...set].sort((a, b) => a.localeCompare(b))];
  }, [periodRuns]);

  const kpis = useMemo(() => {
    const pending = periodRuns.filter((r) => r.pipeline === "pending");
    const processed = periodRuns.filter((r) => r.pipeline === "processed");
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

  const tableRows = useMemo(() => {
    if (vendorFilter === "all") return tabFiltered;
    return tabFiltered.filter((r) => r.vendor === vendorFilter);
  }, [tabFiltered, vendorFilter]);

  const pageCount = Math.max(1, Math.ceil(tableRows.length / pageSize));
  const safePage = Math.min(pageIndex, pageCount - 1);
  const pageStart = safePage * pageSize;
  const pageSlice = tableRows.slice(pageStart, pageStart + pageSize);
  const rangeStart = tableRows.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + pageSize, tableRows.length);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(tableRows.length / pageSize) - 1);
    setPageIndex((i) => (i > maxPage ? maxPage : i));
  }, [tableRows.length, pageSize]);

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

        {!actionDismissed && actionAlert ? (
          <div
            className={cn(
              "rounded-lg border border-rose-200 bg-rose-50/90 py-5 pl-5 pr-4 shadow-sm",
              "dark:border-rose-900/60 dark:bg-rose-950/25",
              "border-l-[6px] border-l-rose-500 dark:border-l-rose-400",
            )}
          >
            <p className="font-semibold text-rose-950 dark:text-rose-100">
              Action required — {actionAlert.vendor}
            </p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-rose-900/90 dark:text-rose-100/90">
              <li>
                {actionAlert.count} run
                {actionAlert.count === 1 ? "" : "s"} in the selected period show
                value validation issues (pending payment path).
              </li>
              <li>
                Review runs for this counterparty and resolve outputs in
                Kognitos before releasing payment.
              </li>
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                asChild
              >
                <Link
                  href={vendorProfileHref(actionAlert.vendor) ?? "#"}
                  onClick={(e) => {
                    if (!vendorProfileHref(actionAlert.vendor)) e.preventDefault();
                  }}
                >
                  See Vendor
                  <ExternalLink className="size-4" />
                </Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-rose-300 bg-white/80 hover:bg-white dark:border-rose-800 dark:bg-transparent"
                onClick={() => setActionDismissed(true)}
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

        <Card>
          <CardHeader>
            <CardTitle>Validation health</CardTitle>
            <CardDescription>
              Aggregated from run pipeline and per-step checks on pending runs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
        </Card>

        <KognitosRunsAnalyzedTable
          loading={loading}
          tab={tab}
          onTabChange={(t) => {
            setTab(t);
            setPageIndex(0);
          }}
          vendorFilter={vendorFilter}
          onVendorFilterChange={(v) => {
            setVendorFilter(v);
            setPageIndex(0);
          }}
          vendorOptions={vendorOptions}
          vendorNameHref={vendorProfileHref}
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
          totalRowCount={tableRows.length}
        />
    </div>
  );
}
