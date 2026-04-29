"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { ExternalLink } from "lucide-react";
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
  DialogDescription,
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
import type { KognitosDashboardRun } from "@/lib/kognitos/normalize-dashboard-run";

/**
 * Only this run uses Kognitos Get Run + `generateDownloadUrl` / HTTPS `file.remote`
 * (see `/api/kognitos/runs/[id]/kognitos-document-url`), not the dashboard PDF proxy.
 */
const RUN_ID_WITH_DOCUMENT_LINK = "5cO1tlyJvQa8bSgnsWLE1";

function formatCompleted(iso: string | null): string {
  if (!iso?.trim()) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy h:mm a");
  } catch {
    return iso;
  }
}

export default function WorklistTestPage() {
  const [runs, setRuns] = useState<KognitosDashboardRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [docDialog, setDocDialog] = useState<{
    open: boolean;
    loading: boolean;
    url: string | null;
    kind: string | null;
    error: string | null;
  }>({
    open: false,
    loading: false,
    url: null,
    kind: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/kognitos/runs");
        const data = (await res.json()) as {
          runs?: KognitosDashboardRun[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error ?? res.statusText);
        }
        if (!cancelled) setRuns(data.runs ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load runs");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function openKognitosDocument() {
    setDocDialog({
      open: true,
      loading: true,
      url: null,
      kind: null,
      error: null,
    });
    try {
      const res = await fetch(
        `/api/kognitos/runs/${encodeURIComponent(RUN_ID_WITH_DOCUMENT_LINK)}/kognitos-document-url`,
      );
      const data = (await res.json()) as {
        url?: string;
        kind?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? res.statusText);
      }
      if (!data.url?.trim()) {
        throw new Error("missing_url");
      }
      setDocDialog({
        open: true,
        loading: false,
        url: data.url.trim(),
        kind: data.kind ?? null,
        error: null,
      });
    } catch (e) {
      setDocDialog({
        open: true,
        loading: false,
        url: null,
        kind: null,
        error: e instanceof Error ? e.message : "Failed to resolve document URL",
      });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium">Test</CardTitle>
          <CardDescription>
            Kognitos runs (Run ID and completion time). For run{" "}
            <span className="font-mono text-xs">{RUN_ID_WITH_DOCUMENT_LINK}</span>
            , the run ID opens the document via Kognitos Get Run and
            <code className="mx-1 rounded bg-muted px-1 text-[11px]">
              files/:generateDownloadUrl
            </code>
            (or an HTTPS <code className="rounded bg-muted px-1 text-[11px]">file.remote</code>
            ).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Loading runs…</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs returned.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Run ID</TableHead>
                    <TableHead>Date completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((row) => {
                    const isLinkedRun = row.id === RUN_ID_WITH_DOCUMENT_LINK;
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-sm tabular-nums">
                          {isLinkedRun ? (
                            <button
                              type="button"
                              onClick={() => void openKognitosDocument()}
                              className="text-left font-mono text-sm text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                              aria-label={`Open Kognitos document for run ${row.id}`}
                            >
                              {row.id}
                            </button>
                          ) : (
                            row.id
                          )}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          {formatCompleted(row.completedAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={docDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            setDocDialog({
              open: false,
              loading: false,
              url: null,
              kind: null,
              error: null,
            });
          }
        }}
      >
        <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Run document (Kognitos)</DialogTitle>
            <DialogDescription>
              Resolved from the live run payload and org Files API. If the frame
              is blank, use “Open in new tab”.
            </DialogDescription>
          </DialogHeader>
          {docDialog.loading ? (
            <p className="text-sm text-muted-foreground">Resolving document URL…</p>
          ) : docDialog.error ? (
            <p className="text-sm text-destructive">{docDialog.error}</p>
          ) : docDialog.url ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              {docDialog.kind ? (
                <p className="text-xs text-muted-foreground">
                  Source: <span className="font-mono">{docDialog.kind}</span>
                </p>
              ) : null}
              <iframe
                title="Kognitos run document"
                src={docDialog.url}
                className="min-h-[70vh] w-full flex-1 rounded-md border border-border bg-muted/30"
              />
              <a
                href={docDialog.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                <ExternalLink className="size-4" aria-hidden />
                Open in new tab
              </a>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
