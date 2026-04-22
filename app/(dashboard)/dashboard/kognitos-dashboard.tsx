"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Check,
  ChevronRight,
  Clock,
  ExternalLink,
  FlaskConical,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
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

const DEMO_DATA_STORAGE_KEY = "kognitos-dashboard-demo-data";
const DEMO_ACTION_REQUIRED_COUNT = 27;
const DEMO_ACTION_REQUIRED_BODY =
  "$347K in pending payments are blocked across PO, goods receipt, COA, and invoice checks.";

/** Matches Action Required tile: $347K total, split across the four issue rows. */
const DEMO_BLOCKED_ISSUE_USD = {
  p2p: 120_000,
  price: 95_000,
  coa: 87_000,
  other: 45_000,
} as const;
const DEMO_BLOCKED_ISSUE_TOTAL =
  DEMO_BLOCKED_ISSUE_USD.p2p +
  DEMO_BLOCKED_ISSUE_USD.price +
  DEMO_BLOCKED_ISSUE_USD.coa +
  DEMO_BLOCKED_ISSUE_USD.other;

const DEMO_TOP_VENDOR_NAME = "ClearPath Laboratory Materials Inc.";
const DEMO_TOP_VENDOR_RUN_COUNT = 28;
const DEMO_TOP_VENDOR_SUM_USD = 672_000;

const DEMO_TOP_ISSUE_TYPE_TITLE = "PO Missmatch";
const DEMO_TOP_ISSUE_TYPE_RUN_COUNT = 12;

/** Runs Analyzed table + vendor filter when demo mode is on. */
const DEMO_RUNS_ANALYZED_VENDORS = [
  "BioPure Chemicals Inc.",
  "Apex Industrial Chemicals Inc.",
  "Northstar BioSolutions LLC",
  "Meridian Chemical Supply Co.",
  "ClearPath Laboratory Materials Inc.",
  "Vector Process Chemicals Ltd.",
  "Summit BioPharma Supplies Inc.",
  "Evergreen Specialty Chemicals LLC.",
  "Titan Molecular Products Co.",
  "BlueRock Chemical Industries Inc.",
] as const;

/** USD amounts for Runs Analyzed (row order when Demo Data is on). */
const DEMO_RUNS_ANALYZED_VALUES_USD = [
  114_800, 112_000, 94_750, 81_300, 67_900, 123_670, 41_800, 29_650, 18_400,
  14_000,
] as const;

/** Cycle demo vendor + value by row index (row 0 = BioPure + $114,800 when filter is All). */
function assignDemoRunsAnalyzedTableFields(
  runs: KognitosDashboardRun[],
): KognitosDashboardRun[] {
  const nv = DEMO_RUNS_ANALYZED_VENDORS.length;
  const nd = DEMO_RUNS_ANALYZED_VALUES_USD.length;
  return runs.map((r, i) => ({
    ...r,
    vendor: DEMO_RUNS_ANALYZED_VENDORS[i % nv],
    vendorIsFromDedicatedKeys: true,
    value: DEMO_RUNS_ANALYZED_VALUES_USD[i % nd],
  }));
}

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Short form for dashboard copy (e.g. $3.46M, $286K). */
function formatCompactUsd(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    const m = amount / 1_000_000;
    const s =
      m >= 100
        ? Math.round(m).toString()
        : m >= 10
          ? m.toFixed(1).replace(/\.0$/, "")
          : m.toFixed(2).replace(/\.?0+$/, "");
    return `$${s}M`;
  }
  if (abs >= 1_000) {
    return `$${Math.round(amount / 1_000)}K`;
  }
  return currencyFmt.format(amount);
}

/** Value-only split of pending runs into issue buckets (mutually exclusive). */
function blockedValueByIssueBuckets(pending: KognitosDashboardRun[]): {
  p2p: number;
  coa: number;
  price: number;
  other: number;
} {
  let p2p = 0;
  let coa = 0;
  let price = 0;
  let other = 0;
  for (const r of pending) {
    const v = r.value;
    if (!r.coaOk) coa += v;
    else if (!r.valOk) price += v;
    else if (!r.docOk || !r.qtyOk) p2p += v;
    else other += v;
  }
  return { p2p, coa, price, other };
}

function DonutHealthyGauge({ healthyPct }: { healthyPct: number }) {
  const pct = Math.min(100, Math.max(0, Math.round(healthyPct)));
  const blockedPct = 100 - pct;
  const r = 36;
  const c = 2 * Math.PI * r;
  const greenLen = (pct / 100) * c;
  const redLen = (blockedPct / 100) * c;
  return (
    <div className="relative mx-auto size-[7.5rem] shrink-0">
      <svg
        viewBox="0 0 100 100"
        className="size-full -rotate-90"
        aria-hidden
      >
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="11"
          className="text-emerald-500"
          strokeDasharray={`${greenLen} ${c}`}
          strokeLinecap="butt"
        />
        {blockedPct > 0 ? (
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="11"
            className="text-red-500"
            strokeDasharray={`${redLen} ${c}`}
            strokeDashoffset={-greenLen}
            strokeLinecap="butt"
          />
        ) : null}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-0.5">
        <span className="text-xl font-bold leading-none tracking-tight text-foreground">
          {pct}%
        </span>
        <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          healthy
        </span>
      </div>
    </div>
  );
}

function BlockedIssueRow({
  label,
  value,
  total,
  dotClass,
  barClass,
}: {
  label: string;
  value: number;
  total: number;
  dotClass: string;
  barClass: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2.5 text-sm">
      <span
        className={cn("size-2 shrink-0 rounded-full", dotClass)}
        aria-hidden
      />
      <span className="w-[10.5rem] shrink-0 font-medium leading-tight text-foreground sm:w-44">
        {label}
      </span>
      <div className="min-h-px min-w-0 flex-1">
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-[width]", barClass)}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      </div>
      <span className="w-[3.25rem] shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
        {formatCompactUsd(value)}
      </span>
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {pct}%
      </span>
    </div>
  );
}

const KPI_BUCKETS = 8;

/** Cumulative series over time buckets for sparklines (sorted by completion date). */
function buildCumulativeSparklinePoints(
  runs: KognitosDashboardRun[],
  include: (r: KognitosDashboardRun) => boolean,
  valueOf: (r: KognitosDashboardRun) => number,
  buckets = KPI_BUCKETS,
): number[] {
  if (runs.length === 0) {
    return Array.from({ length: buckets }, (_, i) => i);
  }
  const sorted = [...runs].sort(
    (a, b) =>
      new Date(a.completedAt ?? a.createdAt).getTime() -
      new Date(b.completedAt ?? b.createdAt).getTime(),
  );
  const points: number[] = [];
  let acc = 0;
  const perBucket = Math.max(1, Math.ceil(sorted.length / buckets));
  for (let b = 0; b < buckets; b++) {
    const chunk = sorted.slice(b * perBucket, (b + 1) * perBucket);
    for (const r of chunk) {
      if (include(r)) acc += valueOf(r);
    }
    points.push(acc);
  }
  if (points.every((p) => p === points[0])) {
    return points.map((p, i) => p + i * 0.5);
  }
  return points;
}

function KpiSparkline({
  points,
  className,
}: {
  points: number[];
  className?: string;
}) {
  const w = 76;
  const h = 36;
  const padX = 2;
  const padY = 5;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const n = points.length;
  const d = points
    .map((p, i) => {
      const x =
        n <= 1 ? w / 2 : padX + (i / (n - 1)) * (w - 2 * padX);
      const y = padY + (1 - (p - min) / span) * (h - 2 * padY);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={cn("shrink-0 text-current", className)}
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
  const [demoDataEnabled, setDemoDataEnabled] = useState(false);

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
    try {
      if (localStorage.getItem(DEMO_DATA_STORAGE_KEY) === "1") {
        setDemoDataEnabled(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setDemoData = useCallback((enabled: boolean) => {
    setDemoDataEnabled(enabled);
    if (enabled) {
      setVendorFilter("all");
    }
    try {
      if (enabled) {
        localStorage.setItem(DEMO_DATA_STORAGE_KEY, "1");
      } else {
        localStorage.removeItem(DEMO_DATA_STORAGE_KEY);
      }
    } catch {
      /* ignore */
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
    if (demoDataEnabled) {
      return ["all", ...DEMO_RUNS_ANALYZED_VENDORS];
    }
    const set = new Set(periodRuns.map((r) => r.vendor));
    return ["all", ...[...set].sort((a, b) => a.localeCompare(b))];
  }, [periodRuns, demoDataEnabled]);

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

  const blockedByIssue = useMemo(() => {
    const pending = periodRuns.filter(
      (r) => !runMeetsTotalApprovedPaymentsRequirements(r),
    );
    return blockedValueByIssueBuckets(pending);
  }, [periodRuns]);

  const blockedIssueTotal = useMemo(() => {
    const b = blockedByIssue;
    return b.p2p + b.coa + b.price + b.other;
  }, [blockedByIssue]);

  const blockedChartByIssue = useMemo(
    () => (demoDataEnabled ? { ...DEMO_BLOCKED_ISSUE_USD } : blockedByIssue),
    [demoDataEnabled, blockedByIssue],
  );

  const blockedChartIssueTotal = useMemo(
    () => (demoDataEnabled ? DEMO_BLOCKED_ISSUE_TOTAL : blockedIssueTotal),
    [demoDataEnabled, blockedIssueTotal],
  );

  const blockedChartExceptionCount = demoDataEnabled
    ? DEMO_ACTION_REQUIRED_COUNT
    : kpis.pendingCount;

  const healthyValuePct = useMemo(() => {
    const vPass = kpis.approvedTotal;
    const vBlock = kpis.pendingTotal;
    const t = vPass + vBlock;
    if (t <= 0) return 100;
    return Math.round((100 * vPass) / t);
  }, [kpis.approvedTotal, kpis.pendingTotal]);

  const pendingSparkPoints = useMemo(
    () =>
      buildCumulativeSparklinePoints(
        periodRuns,
        (r) => !runMeetsTotalApprovedPaymentsRequirements(r),
        (r) => r.value,
      ),
    [periodRuns],
  );

  const approvedSparkPoints = useMemo(
    () =>
      buildCumulativeSparklinePoints(
        periodRuns,
        runMeetsTotalApprovedPaymentsRequirements,
        (r) => r.value,
      ),
    [periodRuns],
  );

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
    if (demoDataEnabled) {
      const sorted = sortDashboardRunsForDisplay(periodRuns);
      const labeled = assignDemoRunsAnalyzedTableFields(sorted);
      if (vendorFilter === "all") return labeled;
      return labeled.filter((r) => r.vendor === vendorFilter);
    }
    if (vendorFilter === "all") return periodRuns;
    return periodRuns.filter((r) => r.vendor === vendorFilter);
  }, [periodRuns, vendorFilter, demoDataEnabled]);

  const tabCounts = useMemo(
    () => ({
      pending: runsForTabCounts.filter((r) => r.pipeline === "pending").length,
      processed: runsForTabCounts.filter((r) => r.pipeline === "processed")
        .length,
      all: runsForTabCounts.length,
    }),
    [runsForTabCounts],
  );

  const runsAnalyzedRows = useMemo(() => {
    const sorted = sortDashboardRunsForDisplay(tabFiltered);

    if (!demoDataEnabled) {
      const vendorFiltered =
        vendorFilter === "all"
          ? sorted
          : sorted.filter((r) => r.vendor === vendorFilter);
      return sortKognitosDashboardRunsByColumn(vendorFiltered, runSort);
    }

    const preLabeled = assignDemoRunsAnalyzedTableFields(sorted);
    const filtered =
      vendorFilter === "all"
        ? preLabeled
        : preLabeled.filter((r) => r.vendor === vendorFilter);
    const columnSorted = sortKognitosDashboardRunsByColumn(filtered, runSort);

    if (vendorFilter === "all") {
      return assignDemoRunsAnalyzedTableFields(columnSorted);
    }
    const nd = DEMO_RUNS_ANALYZED_VALUES_USD.length;
    return columnSorted.map((r, i) => ({
      ...r,
      vendor: vendorFilter,
      vendorIsFromDedicatedKeys: true,
      value: DEMO_RUNS_ANALYZED_VALUES_USD[i % nd],
    }));
  }, [tabFiltered, vendorFilter, demoDataEnabled, runSort]);

  const handleSortColumn = useCallback((key: DashboardRunSortKey) => {
    setRunSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
    setPageIndex(0);
  }, []);

  const pageCount = Math.max(1, Math.ceil(runsAnalyzedRows.length / pageSize));
  const safePage = Math.min(pageIndex, pageCount - 1);
  const pageStart = safePage * pageSize;
  const pageSlice = runsAnalyzedRows.slice(pageStart, pageStart + pageSize);
  const rangeStart = runsAnalyzedRows.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + pageSize, runsAnalyzedRows.length);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(runsAnalyzedRows.length / pageSize) - 1);
    setPageIndex((i) => (i > maxPage ? maxPage : i));
  }, [runsAnalyzedRows.length, pageSize]);

  return (
    <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 shrink-0 text-muted-foreground/50 hover:text-muted-foreground"
                    aria-label="Dashboard options"
                  >
                    <MoreHorizontal className="size-4" strokeWidth={2} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56" sideOffset={4}>
                  <DropdownMenuCheckboxItem
                    checked={demoDataEnabled}
                    onCheckedChange={(c) => setDemoData(!!c)}
                  >
                    Enable Demo Data
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <p className="mt-1 text-muted-foreground">
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

        <div
          className={cn(
            "grid grid-cols-1 gap-4",
            !expertQueueBannerDismissed && "lg:grid-cols-2",
          )}
        >
          {!expertQueueBannerDismissed ? (
            <Card
              className={cn(
                "rounded-xl border border-border bg-background py-0 shadow-sm",
                "dark:bg-card",
              )}
            >
              <CardContent className="space-y-4 px-5 py-5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
                  Action required
                </p>
                <p className="text-4xl font-bold leading-none tracking-tight text-foreground sm:text-5xl">
                  {demoDataEnabled
                    ? DEMO_ACTION_REQUIRED_COUNT
                    : expertQueueCount !== null
                      ? expertQueueCount
                      : kpis.pendingCount}
                </p>
                <p className="text-base font-semibold leading-snug text-foreground">
                  P2P exceptions need expert review.
                </p>
                <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
                  {demoDataEnabled
                    ? DEMO_ACTION_REQUIRED_BODY
                    : `${formatCompactUsd(kpis.pendingTotal)} in pending payments are blocked across PO, goods receipt, COA, and invoice checks.`}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 gap-2 rounded-lg border-border bg-background font-medium shadow-none hover:bg-muted/50"
                    asChild
                  >
                    <Link
                      href="/expert-queue"
                      className="inline-flex items-center gap-2"
                    >
                      Review expert queue
                      <ExternalLink className="size-4 opacity-70" />
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-lg border-border bg-background px-4 font-medium shadow-none hover:bg-muted/50"
                    onClick={() => setExpertQueueBannerDismissed(true)}
                  >
                    Dismiss
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
          <Card
            className={cn(
              "rounded-xl border border-border bg-background py-0 shadow-sm",
              "dark:bg-card",
              expertQueueBannerDismissed && "lg:col-span-2",
            )}
          >
            <CardContent className="px-5 py-5">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
                <DonutHealthyGauge
                  healthyPct={demoDataEnabled ? 93 : healthyValuePct}
                />
                <div className="min-w-0 flex-1 space-y-5">
                  <div>
                    <h2 className="text-lg font-bold tracking-tight text-foreground">
                      Blocked value by issue
                    </h2>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      {formatCompactUsd(
                        demoDataEnabled ? DEMO_BLOCKED_ISSUE_TOTAL : kpis.pendingTotal,
                      )}{" "}
                      total blocked across {blockedChartExceptionCount}{" "}
                      {blockedChartExceptionCount === 1
                        ? "exception"
                        : "exceptions"}
                      .
                    </p>
                  </div>
                  <div className="space-y-3.5">
                    <BlockedIssueRow
                      label="PO Missmatch"
                      value={blockedChartByIssue.p2p}
                      total={blockedChartIssueTotal}
                      dotClass="bg-blue-500"
                      barClass="bg-blue-500"
                    />
                    <BlockedIssueRow
                      label="Price Variance"
                      value={blockedChartByIssue.price}
                      total={blockedChartIssueTotal}
                      dotClass="bg-indigo-500 dark:bg-indigo-400"
                      barClass="bg-indigo-500 dark:bg-indigo-400"
                    />
                    <BlockedIssueRow
                      label="COA Issue"
                      value={blockedChartByIssue.coa}
                      total={blockedChartIssueTotal}
                      dotClass="bg-zinc-600 dark:bg-zinc-400"
                      barClass="bg-zinc-600 dark:bg-zinc-400"
                    />
                    <BlockedIssueRow
                      label="Other"
                      value={blockedChartByIssue.other}
                      total={blockedChartIssueTotal}
                      dotClass="bg-muted-foreground/40"
                      barClass="bg-muted-foreground/35"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="rounded-xl border border-border bg-background py-0 shadow-sm dark:bg-card">
            <CardContent className="flex items-center gap-3 px-4 py-4 sm:gap-4">
              <div
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400"
                aria-hidden
              >
                <Clock className="size-5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Total Pending Payments
                </p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                  {currencyFmt.format(kpis.pendingTotal)}
                </p>
                <p className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-400">
                  {kpis.pendingCount} pending runs
                </p>
              </div>
              <div className="hidden shrink-0 text-blue-500 sm:block dark:text-blue-400">
                <KpiSparkline points={pendingSparkPoints} />
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-xl border border-border bg-background py-0 shadow-sm dark:bg-card">
            <CardContent className="flex items-center gap-3 px-4 py-4 sm:gap-4">
              <div
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/45 dark:text-emerald-400"
                aria-hidden
              >
                <Check className="size-5" strokeWidth={2.5} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Total Approved Payments
                </p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                  {currencyFmt.format(kpis.approvedTotal)}
                </p>
                <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  {kpis.processedCount} processed runs
                </p>
              </div>
              <div className="hidden shrink-0 text-emerald-500 sm:block dark:text-emerald-400">
                <KpiSparkline points={approvedSparkPoints} />
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-xl border border-border bg-background py-0 shadow-sm dark:bg-card">
            <CardContent className="flex items-center gap-3 px-4 py-4 sm:gap-4">
              <div
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600 dark:bg-violet-950/45 dark:text-violet-400"
                aria-hidden
              >
                <Building2 className="size-5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Top Vendor
                </p>
                <p className="mt-1 line-clamp-2 text-lg font-bold leading-snug tracking-tight text-foreground">
                  {demoDataEnabled ? DEMO_TOP_VENDOR_NAME : kpis.topVendor.name}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {demoDataEnabled
                    ? DEMO_TOP_VENDOR_RUN_COUNT
                    : kpis.topVendor.count}{" "}
                  runs ·{" "}
                  <span className="font-medium text-blue-600 dark:text-blue-400">
                    {currencyFmt.format(
                      demoDataEnabled
                        ? DEMO_TOP_VENDOR_SUM_USD
                        : kpis.topVendor.sum,
                    )}
                  </span>{" "}
                  total value
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-xl border border-border bg-background py-0 shadow-sm dark:bg-card">
            <CardContent className="flex items-center gap-3 px-4 py-4 sm:gap-4">
              <div
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400"
                aria-hidden
              >
                <FlaskConical className="size-5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Top Issue Type
                </p>
                <p className="mt-1 line-clamp-2 text-lg font-bold leading-snug tracking-tight text-foreground">
                  {demoDataEnabled ? DEMO_TOP_ISSUE_TYPE_TITLE : kpis.topLine.title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-medium text-orange-600 dark:text-orange-400">
                    {demoDataEnabled
                      ? DEMO_TOP_ISSUE_TYPE_RUN_COUNT
                      : kpis.topLine.count}{" "}
                    runs
                  </span>{" "}
                  (from user inputs)
                </p>
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
          vendorNameHref={(v) =>
            demoDataEnabled ? null : vendorProfileHref(v)
          }
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
          totalRowCount={runsAnalyzedRows.length}
          description="Review and manage analyzed invoice runs."
        />
        </Card>
    </div>
  );
}
