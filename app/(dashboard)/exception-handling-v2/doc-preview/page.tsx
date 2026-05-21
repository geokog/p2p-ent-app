"use client";

import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ExternalLink, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PdfHighlightViewerV2 } from "@/components/kognitos/pdf-highlight-viewer-v2";
import type { KognitosDashboardRun } from "@/lib/kognitos/normalize-dashboard-run";

const COMPLETED_LIMIT = 10;

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

/**
 * Active document-preview target for the dialog. Carries the same triple
 * the kognitos-plugin's document-preview reference describes for any
 * preview entry point: a same-origin PDF URL, the run id (used as the
 * dialog `key` so internal refs reset across runs), and a display label
 * that becomes the dialog title (filename / invoice number).
 */
type DocPreviewTarget = {
  pdfUrl: string;
  runId: string;
  label: string;
};

export default function ExceptionsV2DocPreviewPage() {
  const [runs, setRuns] = useState<KognitosDashboardRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * `null` while no document is being previewed; a {@link DocPreviewTarget}
   * once an operator clicks an invoice id. Setting back to `null` closes
   * the dialog and triggers the viewer's `runId`-keyed cleanup
   * (AbortController, RenderTask cancellation, pendingScroll clear).
   */
  const [docPreview, setDocPreview] = useState<DocPreviewTarget | null>(null);

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

  const completedRuns = useMemo(() => {
    return [...runs]
      .filter((r) => r.runStatus === "Completed")
      .sort((a, b) => {
        const at = safeParse(runTimestampIso(a))?.getTime() ?? 0;
        const bt = safeParse(runTimestampIso(b))?.getTime() ?? 0;
        return bt - at;
      })
      .slice(0, COMPLETED_LIMIT);
  }, [runs]);

  return (
    <div className="w-full max-w-none space-y-6 px-4 py-6 sm:px-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">doc-preview</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Last {COMPLETED_LIMIT} completed automation runs (runs in the{" "}
          <code className="font-mono">Completed</code> state).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Completed runs</CardTitle>
          <CardDescription>
            Sourced from <code className="font-mono">/api/kognitos/runs</code>;
            sorted newest first. Click an invoice id to open the document with
            IDP bounding boxes and per-field confidence bars.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="rounded-lg border border-border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[24%]">Invoice ID</TableHead>
                  <TableHead className="w-[14%]">Date automation ran</TableHead>
                  <TableHead className="w-[20%]">Timestamp of run</TableHead>
                  <TableHead className="w-[28%]">Run ID</TableHead>
                  <TableHead className="w-[14%] text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-6 text-center text-sm text-muted-foreground"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                        Loading runs…
                      </span>
                    </TableCell>
                  </TableRow>
                ) : completedRuns.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-6 text-center text-sm text-muted-foreground"
                    >
                      No completed runs to show.
                    </TableCell>
                  </TableRow>
                ) : (
                  completedRuns.map((run) => {
                    const iso = runTimestampIso(run);
                    const label = run.invoiceNumber || "—";
                    const pdfUrl = run.invoicePdfUrl;
                    const runUrl = run.kognitosRunUrl?.trim() || null;
                    return (
                      <TableRow key={run.id}>
                        <TableCell className="break-all py-2 font-mono text-sm">
                          {pdfUrl ? (
                            <button
                              type="button"
                              title={`Open ${label}`}
                              aria-label={`Open ${label} document preview`}
                              onClick={() =>
                                setDocPreview({
                                  pdfUrl,
                                  runId: run.id,
                                  label,
                                })
                              }
                              className={cn(
                                "block w-full truncate text-left text-foreground underline-offset-4 hover:underline",
                                "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              )}
                            >
                              {label}
                            </button>
                          ) : (
                            <span
                              className="block truncate text-muted-foreground"
                              title="No PDF available for this run"
                            >
                              {label}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-sm">
                          {formatRunDate(iso)}
                        </TableCell>
                        <TableCell className="py-2 font-mono text-xs text-muted-foreground">
                          {formatRunTimestamp(iso)}
                        </TableCell>
                        <TableCell
                          className="break-all py-2 font-mono text-xs text-muted-foreground"
                          title={run.id}
                        >
                          {run.id}
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          {runUrl ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2 text-xs"
                              asChild
                            >
                              <a
                                href={runUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Open run ${run.id} in Kognitos`}
                              >
                                Open in Kognitos
                                <ExternalLink
                                  className="ml-1 size-3 opacity-70"
                                  aria-hidden
                                />
                              </a>
                            </Button>
                          ) : (
                            <span
                              className="text-xs text-muted-foreground"
                              title="Kognitos app URL not configured (KOGNITOS_APP_BASE_URL / org / workspace env vars)"
                            >
                              —
                            </span>
                          )}
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

      {/*
        In-app document preview.

        Per the kognitos-plugin's `kognitos-app-development/references/document-preview.md`:
          - Open the viewer in a *modal dialog*, never a browser popup; even
            non-chat entry points stay in-app.
          - Mount the viewer with `key={runId}` so canvas refs, the
            RenderTask ref, the locked fit-cap, the focused-field id, and
            the in-flight AbortControllers all reset cleanly when the
            operator switches to a different invoice (defense-in-depth on
            top of the viewer's own runId-keyed effects).
          - The DialogTitle shows the document filename / invoice number
            ("Dialog Title Parity") — never a generic "Document
            Processing" label, so the dialog matches the surface the
            operator just left.
          - The dialog shell uses the three-band dark palette
            (near-black shell, mid-dark workspace, document is the only
            light surface) so the document itself is the focal point.
            ~90vw × 90vh is the reference default; we map it through the
            same `bg-zinc-900` surface tokens the in-repo viewer uses.
      */}
      <Dialog
        open={docPreview != null}
        onOpenChange={(open) => {
          if (!open) setDocPreview(null);
        }}
      >
        <DialogContent
          centerFlex
          showCloseButton
          className={cn(
            "flex h-[min(82.8vh,828px)] w-[min(88.2vw,82.8rem)] max-w-[min(88.2vw,82.8rem)]",
            "flex-col gap-0 overflow-hidden border border-white/[0.08] bg-zinc-900 p-0",
            "text-zinc-100 shadow-xl shadow-black/20 sm:max-w-[min(88.2vw,82.8rem)]",
            "[&_[data-slot=dialog-close]]:text-zinc-400 [&_[data-slot=dialog-close]]:hover:text-zinc-100",
          )}
        >
          <DialogHeader className="shrink-0 border-b border-white/[0.07] bg-zinc-900 px-4 py-2 text-left">
            <DialogTitle className="text-base font-medium text-zinc-50">
              {docPreview?.label ?? "Document Processing"}
            </DialogTitle>
          </DialogHeader>
          {docPreview ? (
            <PdfHighlightViewerV2
              key={docPreview.runId}
              pdfUrl={docPreview.pdfUrl}
              runId={docPreview.runId}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
