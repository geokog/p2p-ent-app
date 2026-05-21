"use client";

import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Loader2 } from "lucide-react";

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

const INCOMPLETE_LIMIT = 10;

type RunsResponse = {
  runs?: KognitosDashboardRun[];
  error?: string;
};

/**
 * Pick the most informative timestamp for "when the automation ran".
 *
 * Runs that never reached `state.completed` won't have `completedAt`, so we
 * fall back to `createdAt`. `KognitosDashboardRun.createdAt` is guaranteed
 * present (defaulted to epoch when raw payload had nothing).
 */
function runTimestampIso(run: KognitosDashboardRun): string {
  return run.completedAt ?? run.createdAt;
}

function safeParse(iso: string): Date | null {
  if (!iso) return null;
  try {
    const d = parseISO(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function formatRunDate(iso: string): string {
  const d = safeParse(iso);
  return d ? format(d, "MMM d, yyyy") : "—";
}

function formatRunTimestamp(iso: string): string {
  const d = safeParse(iso);
  return d ? format(d, "yyyy-MM-dd HH:mm:ss") : "—";
}

export default function ExceptionsV2ChatPage() {
  const [runs, setRuns] = useState<KognitosDashboardRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/kognitos/runs", { cache: "no-store" });
        const data = (await res.json()) as RunsResponse;
        if (!res.ok) throw new Error(data.error ?? res.statusText);
        if (!cancelled) setRuns(data.runs ?? []);
      } catch (e) {
        if (!cancelled) {
          setRuns([]);
          setError(e instanceof Error ? e.message : "Failed to load runs.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const incompleteRuns = useMemo(() => {
    return [...runs]
      .filter((r) => r.runStatus !== "Completed")
      .sort((a, b) => {
        const at = safeParse(runTimestampIso(a))?.getTime() ?? 0;
        const bt = safeParse(runTimestampIso(b))?.getTime() ?? 0;
        return bt - at;
      })
      .slice(0, INCOMPLETE_LIMIT);
  }, [runs]);

  return (
    <div className="w-full max-w-none space-y-6 px-4 py-6 sm:px-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">chat</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Last {INCOMPLETE_LIMIT} incomplete automation runs (anything not in the{" "}
          <code className="font-mono">Completed</code> state).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Incomplete runs</CardTitle>
          <CardDescription>
            Sourced from <code className="font-mono">/api/kognitos/runs</code>;
            sorted newest first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="rounded-lg border border-border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[40%]">Invoice ID</TableHead>
                  <TableHead className="w-[24%]">Date automation ran</TableHead>
                  <TableHead className="w-[36%]">Timestamp of run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="py-6 text-center text-sm text-muted-foreground"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                        Loading runs…
                      </span>
                    </TableCell>
                  </TableRow>
                ) : incompleteRuns.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="py-6 text-center text-sm text-muted-foreground"
                    >
                      No incomplete runs to show.
                    </TableCell>
                  </TableRow>
                ) : (
                  incompleteRuns.map((run) => {
                    const iso = runTimestampIso(run);
                    return (
                      <TableRow key={run.id}>
                        <TableCell className="break-all py-2 font-mono text-sm">
                          {run.invoiceNumber || "—"}
                        </TableCell>
                        <TableCell className="py-2 text-sm">
                          {formatRunDate(iso)}
                        </TableCell>
                        <TableCell className="py-2 font-mono text-xs text-muted-foreground">
                          {formatRunTimestamp(iso)}
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
