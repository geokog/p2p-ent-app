"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FileText, Mail } from "lucide-react";
import { KognitosRunsAnalyzedTable } from "@/components/kognitos/kognitos-runs-analyzed-table";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type KognitosDashboardRun,
  type PeriodFilter,
  filterRunsByPeriod,
} from "@/lib/kognitos/normalize-dashboard-run";
import {
  decodeVendorSlugParam,
  stableVendorDisplayId,
} from "@/lib/vendors/vendor-path";
import { cn } from "@/lib/utils";

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function aggregateAlert(
  runs: KognitosDashboardRun[],
  predicate: (r: KognitosDashboardRun) => boolean,
): {
  count: number;
  sum: number;
  lines: string[];
} {
  const hit = runs.filter(predicate);
  const sum = hit.reduce((s, r) => s + r.value, 0);
  const lineMap = new Map<string, number>();
  for (const r of hit) {
    const label = r.lineItem?.trim() || r.invoiceNumber;
    lineMap.set(label, (lineMap.get(label) ?? 0) + 1);
  }
  const lines = [...lineMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([title, n]) => `${title}${n > 1 ? ` — ×${n}` : ""}`);
  return { count: hit.length, sum, lines };
}

export function VendorProfileContent() {
  const params = useParams();
  const rawSlug = params?.vendorSlug;
  const vendorName =
    typeof rawSlug === "string" ? decodeVendorSlugParam(rawSlug) : "";

  const [period, setPeriod] = useState<PeriodFilter>("all");
  const [runs, setRuns] = useState<KognitosDashboardRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<"pending" | "processed" | "all">("all");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);

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
      setError("Could not load runs.");
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

  const vendorRuns = useMemo(
    () => periodRuns.filter((r) => r.vendor === vendorName),
    [periodRuns, vendorName],
  );

  const displayId = useMemo(
    () => stableVendorDisplayId(vendorName || "unknown"),
    [vendorName],
  );

  const valAlert = useMemo(
    () =>
      aggregateAlert(
        vendorRuns,
        (r) => r.pipeline === "pending" && !r.valOk && r.vendor !== "—",
      ),
    [vendorRuns],
  );

  const coaAlert = useMemo(
    () =>
      aggregateAlert(
        vendorRuns,
        (r) => r.pipeline === "pending" && !r.coaOk && r.vendor !== "—",
      ),
    [vendorRuns],
  );

  const annualSpend = useMemo(
    () => vendorRuns.reduce((s, r) => s + r.value, 0),
    [vendorRuns],
  );

  const materialKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of vendorRuns) {
      const k = r.lineItem?.trim();
      if (k && k !== r.invoiceNumber) set.add(k);
    }
    return [...set].slice(0, 8);
  }, [vendorRuns]);

  const [materialTab, setMaterialTab] = useState<string>("");
  useEffect(() => {
    if (materialKeys.length === 0) {
      setMaterialTab("");
      return;
    }
    if (!materialTab || !materialKeys.includes(materialTab)) {
      setMaterialTab(materialKeys[0] ?? "");
    }
  }, [materialKeys, materialTab]);

  const tabFiltered = useMemo(() => {
    if (tab === "all") return vendorRuns;
    return vendorRuns.filter((r) => r.pipeline === tab);
  }, [vendorRuns, tab]);

  const pageCount = Math.max(1, Math.ceil(tabFiltered.length / pageSize));
  const safePage = Math.min(pageIndex, pageCount - 1);
  const pageStart = safePage * pageSize;
  const pageSlice = tabFiltered.slice(pageStart, pageStart + pageSize);
  const rangeStart = tabFiltered.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + pageSize, tabFiltered.length);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(tabFiltered.length / pageSize) - 1);
    setPageIndex((i) => (i > maxPage ? maxPage : i));
  }, [tabFiltered.length, pageSize]);

  if (!vendorName.trim()) {
    return (
      <p className="text-sm text-muted-foreground">
        Invalid vendor link.{" "}
        <Link href="/vendors" className="text-primary underline-offset-4 hover:underline">
          Back to vendors
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" className="-ml-2 gap-1.5 px-2" asChild>
            <Link href="/vendors">
              <ArrowLeft className="size-4" />
              Vendors
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">{vendorName}</h1>
          <p className="text-sm text-muted-foreground tabular-nums">{displayId}</p>
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

      {(valAlert.count > 0 || coaAlert.count > 0) && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-rose-900 dark:text-rose-100">
            Action items
          </h2>
          <div className="space-y-3">
            {valAlert.count > 0 ? (
              <div
                className={cn(
                  "rounded-lg border border-rose-200 bg-rose-50/90 p-4 shadow-sm",
                  "dark:border-rose-900/60 dark:bg-rose-950/25",
                )}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="font-semibold text-rose-950 dark:text-rose-100">
                      Value match failed
                    </p>
                    <p className="text-sm text-rose-900/90 dark:text-rose-100/90">
                      Validate invoice totals against the active price list or
                      contract for this vendor, then re-run matching in Kognitos.
                    </p>
                    <p className="text-xs font-medium text-rose-900/80 dark:text-rose-200/80">
                      {valAlert.count} invoice{valAlert.count === 1 ? "" : "s"}{" "}
                      · {currencyFmt.format(valAlert.sum)} combined
                    </p>
                    <ul className="list-disc space-y-1 pl-4 text-xs text-rose-900/85 dark:text-rose-100/85">
                      {valAlert.lines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" className="gap-2" disabled>
                      <Mail className="size-4" />
                      Draft email
                    </Button>
                    <Button type="button" size="sm" variant="secondary" disabled>
                      Mark as read
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
            {coaAlert.count > 0 ? (
              <div
                className={cn(
                  "rounded-lg border border-rose-200 bg-rose-50/90 p-4 shadow-sm",
                  "dark:border-rose-900/60 dark:bg-rose-950/25",
                )}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="font-semibold text-rose-950 dark:text-rose-100">
                      COA validation failed
                    </p>
                    <p className="text-sm text-rose-900/90 dark:text-rose-100/90">
                      Review certificate-of-analysis outputs against quality
                      specifications before releasing payment.
                    </p>
                    <p className="text-xs font-medium text-rose-900/80 dark:text-rose-200/80">
                      {coaAlert.count} invoice{coaAlert.count === 1 ? "" : "s"}{" "}
                      · {currencyFmt.format(coaAlert.sum)} combined
                    </p>
                    <ul className="list-disc space-y-1 pl-4 text-xs text-rose-900/85 dark:text-rose-100/85">
                      {coaAlert.lines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" className="gap-2" disabled>
                      <Mail className="size-4" />
                      Draft email
                    </Button>
                    <Button type="button" size="sm" variant="secondary" disabled>
                      Mark as read
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 border-b sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Overview</CardTitle>
            <CardDescription>
              Spend and terms from synced runs; enrich with vendor master data
              when available.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Qualified</Badge>
            <Badge variant="outline">Risk low</Badge>
            <Badge className="border-transparent bg-lime-500/90 text-lime-950 hover:bg-lime-500">
              Preferred
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Primary contact
            </p>
            <p className="mt-1 text-sm font-medium">Accounts payable liaison</p>
            <p className="text-sm text-muted-foreground">—</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Country / region
            </p>
            <p className="mt-1 text-sm">—</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Payment terms
            </p>
            <p className="mt-1 text-sm font-medium">Net 30 (USD)</p>
            <p className="text-sm text-muted-foreground">Electronic (EDI)</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Annual spend (runs in view)
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {currencyFmt.format(annualSpend)}
            </p>
            <p className="text-xs text-muted-foreground">
              Filtered by period selector
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-5 text-muted-foreground" />
            Materials
          </CardTitle>
          <CardDescription>
            Line items inferred from run payloads for this vendor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {materialKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No distinct line items yet for this vendor.
            </p>
          ) : (
            <Tabs value={materialTab} onValueChange={setMaterialTab}>
              <TabsList className="mb-4 h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
                {materialKeys.map((k) => (
                  <TabsTrigger
                    key={k}
                    value={k}
                    className="max-w-[220px] truncate rounded-md border bg-background px-3 py-1.5 text-xs data-[state=active]:border-primary data-[state=active]:bg-muted"
                  >
                    {k}
                  </TabsTrigger>
                ))}
              </TabsList>
              {materialKeys.map((k) => (
                <TabsContent key={k} value={k} className="mt-0 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg border bg-background p-4">
                      <p className="text-xs font-medium text-muted-foreground">
                        Product
                      </p>
                      <p className="mt-1 line-clamp-3 text-sm font-medium">{k}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Catalog / CAS appear when wired to material master.
                      </p>
                    </div>
                    <div className="rounded-lg border bg-background p-4">
                      <p className="text-xs font-medium text-muted-foreground">
                        Pricing
                      </p>
                      <p className="mt-1 text-sm">—</p>
                      <p className="text-xs text-muted-foreground">MOQ —</p>
                    </div>
                    <div className="rounded-lg border bg-background p-4">
                      <p className="text-xs font-medium text-muted-foreground">
                        Logistics
                      </p>
                      <p className="mt-1 text-sm">—</p>
                      <p className="text-xs text-muted-foreground">
                        Lead time / ship point — when available
                      </p>
                    </div>
                    <div className="rounded-lg border bg-background p-4">
                      <p className="text-xs font-medium text-muted-foreground">
                        Compliance
                      </p>
                      <p className="mt-1 text-sm">GMP / COA / MSDS —</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Ops notes: tie-ins to procurement policies can live here once
                    connected to your vendor record.
                  </p>
                </TabsContent>
              ))}
            </Tabs>
          )}
        </CardContent>
      </Card>

      <KognitosRunsAnalyzedTable
        title="Invoices analyzed"
        description="Invoices validated against goods receipt, purchase orders, and quality signals from synced Kognitos runs (4-way style matching)."
        loading={loading}
        tab={tab}
        onTabChange={(t) => {
          setTab(t);
          setPageIndex(0);
        }}
        showVendorSelect={false}
        vendorFilter="all"
        onVendorFilterChange={() => {}}
        vendorOptions={["all"]}
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
        totalRowCount={tabFiltered.length}
      />

      {!loading && vendorRuns.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          No runs in this period for{" "}
          <span className="font-medium text-foreground">{vendorName}</span>. Try
          &quot;All time&quot; or sync additional runs.
        </p>
      ) : null}
    </div>
  );
}
