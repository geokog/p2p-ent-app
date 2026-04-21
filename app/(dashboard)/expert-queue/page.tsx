"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  ExternalLink,
  LifeBuoy,
  Loader2,
  MessageCircleWarning,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  ExpertQueueIssueBadge,
  ExpertQueueRow,
} from "@/lib/kognitos/expert-queue-issue";
import { cn } from "@/lib/utils";

const ISSUE_BADGE_LABEL: Record<ExpertQueueIssueBadge, string> = {
  po_not_found: "Missing Details",
  posting_date: "Posting Date",
  book: "Book",
  missing_invoice_number: "Missing Invoice Number",
  missing_po_number: "Missing PO Number",
  missing_details: "Missing Details",
  sap_permissions_required: "SAP Permissions Required",
  invalid_po_format: "Invalid PO Format",
  other: "Other",
};

const MISSING_DETAILS_BADGE_CLASS =
  "border-amber-500/40 bg-amber-500/10 text-amber-950 dark:border-amber-400/35 dark:bg-amber-950/40 dark:text-amber-100";

const ISSUE_BADGE_CLASS: Record<ExpertQueueIssueBadge, string> = {
  po_not_found: MISSING_DETAILS_BADGE_CLASS,
  posting_date:
    "border-sky-500/40 bg-sky-500/10 text-sky-950 dark:border-sky-400/35 dark:bg-sky-950/40 dark:text-sky-100",
  book: "border-emerald-500/40 bg-emerald-500/10 text-emerald-950 dark:border-emerald-400/35 dark:bg-emerald-950/40 dark:text-emerald-100",
  missing_invoice_number:
    "border-cyan-600/35 bg-cyan-500/10 text-cyan-950 dark:border-cyan-400/35 dark:bg-cyan-950/45 dark:text-cyan-100",
  missing_po_number:
    "border-rose-500/40 bg-rose-500/10 text-rose-950 dark:border-rose-400/35 dark:bg-rose-950/40 dark:text-rose-100",
  missing_details: MISSING_DETAILS_BADGE_CLASS,
  sap_permissions_required:
    "border-purple-600/35 bg-purple-500/10 text-purple-950 dark:border-purple-400/35 dark:bg-purple-950/45 dark:text-purple-100",
  invalid_po_format:
    "border-orange-600/35 bg-orange-500/10 text-orange-950 dark:border-orange-400/35 dark:bg-orange-950/40 dark:text-orange-100",
  other:
    "border-muted-foreground/30 bg-muted/40 text-muted-foreground dark:bg-muted/25",
};

export default function ExpertQueuePage() {
  const [items, setItems] = useState<ExpertQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/kognitos/expert-queue");
        const json = (await res.json()) as {
          items?: ExpertQueueRow[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          const raw = json.error ?? "";
          const friendly =
            raw === "supabase_admin_missing"
              ? "Saved runs are not available right now. Check that the app is connected to the database."
              : raw
                ? "Something went wrong while loading the queue. Try again in a moment."
                : "Something went wrong while loading the queue.";
          setError(friendly);
          setItems([]);
          return;
        }
        setItems(json.items ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(
            "We could not reach the server to load this page. Check your connection and try again.",
          );
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <LifeBuoy className="size-7 text-muted-foreground" aria-hidden />
          Expert Queue
        </h1>
        <p className="mt-1 text-muted-foreground">
          Items in the Expert Queue are ready for review and resolution. Use the
          explanation below to help each run move successfully toward completion.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading runs…
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">No blocked runs</CardTitle>
            <CardDescription>
              There are no synced runs in a Failed or Awaiting guidance state. When
              Kognitos syncs such runs into this app, they will appear here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="space-y-4">
        {items.map((item) => (
          <Card key={item.runId}>
            <CardHeader className="space-y-3 pb-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="pt-0.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs font-semibold",
                        ISSUE_BADGE_CLASS[item.issueBadge],
                      )}
                    >
                      {ISSUE_BADGE_LABEL[item.issueBadge]}
                    </Badge>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      item.issueKind === "failed" ? "destructive" : "secondary"
                    }
                    className={cn(
                      item.issueKind === "awaiting_guidance" &&
                        "border-amber-500/50 bg-amber-500/15 text-amber-950 dark:text-amber-100",
                    )}
                  >
                    {item.issueKind === "failed" ? (
                      <AlertCircle className="mr-1 size-3.5" aria-hidden />
                    ) : (
                      <MessageCircleWarning
                        className="mr-1 size-3.5"
                        aria-hidden
                      />
                    )}
                    {item.stateLabel}
                  </Badge>
                  {item.kognitosRunUrl ? (
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={item.kognitosRunUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open in Kognitos
                        <ExternalLink className="ml-1 size-3.5" aria-hidden />
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="text-sm">
                <CardDescription className="space-y-2 text-foreground">
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 leading-relaxed">
                    <span className="shrink-0 font-bold text-foreground">
                      Explanation:
                    </span>
                    <span className="min-w-0 text-foreground">{item.whySummary}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last updated: {item.updateTime ?? item.createTime ?? "—"}
                  </p>
                </CardDescription>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
