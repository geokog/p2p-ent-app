"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { KognitosDashboardRun } from "@/lib/kognitos/normalize-dashboard-run";
import { vendorProfileHref } from "@/lib/vendors/vendor-path";

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default function VendorsIndexPage() {
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
      setError("Could not load vendors.");
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

  const rows = useMemo(() => {
    const by = new Map<
      string,
      { count: number; sum: number; pending: number }
    >();
    for (const r of runs) {
      const v = r.vendor.trim();
      if (!v || v === "—") continue;
      const cur = by.get(v) ?? { count: 0, sum: 0, pending: 0 };
      cur.count += 1;
      cur.sum += r.value;
      if (r.pipeline === "pending") cur.pending += 1;
      by.set(v, cur);
    }
    return [...by.entries()]
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.sum - a.sum);
  }, [runs]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Vendors</h1>
        <p className="text-muted-foreground">
          Counterparties seen on synced Kognitos runs. Open a vendor to review
          action items and analyzed invoices.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-5 text-muted-foreground" />
            Vendor directory
          </CardTitle>
          <CardDescription>
            Derived from run payloads. Master-data fields (contacts, terms) are
            shown on each vendor profile.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <div className="mx-6 rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Total value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="h-24 text-center text-muted-foreground"
                    >
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No vendors yet. Sync Kognitos runs from Settings.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const href = vendorProfileHref(row.name);
                    return (
                      <TableRow key={row.name}>
                        <TableCell className="font-medium">
                          {href ? (
                            <Link
                              href={href}
                              className="text-primary underline-offset-4 hover:underline"
                            >
                              {row.name}
                            </Link>
                          ) : (
                            row.name
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.count}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.pending}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {currencyFmt.format(row.sum)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
