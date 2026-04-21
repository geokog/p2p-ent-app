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
  po_not_found: "PO Not Found",
  posting_date: "Posting Date",
  book: "Book",
  missing_details: "Missing Details",
  other: "Other",
};

const ISSUE_BADGE_CLASS: Record<ExpertQueueIssueBadge, string> = {
  po_not_found:
    "border-violet-500/40 bg-violet-500/10 text-violet-950 dark:border-violet-400/35 dark:bg-violet-950/40 dark:text-violet-100",
  posting_date:
    "border-sky-500/40 bg-sky-500/10 text-sky-950 dark:border-sky-400/35 dark:bg-sky-950/40 dark:text-sky-100",
  book: "border-emerald-500/40 bg-emerald-500/10 text-emerald-950 dark:border-emerald-400/35 dark:bg-emerald-950/40 dark:text-emerald-100",
  missing_details:
    "border-amber-500/40 bg-amber-500/10 text-amber-950 dark:border-amber-400/35 dark:bg-amber-950/40 dark:text-amber-100",
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
          Runs that did not complete because they{" "}
          <strong className="font-medium text-foreground">failed</strong> or are{" "}
          <strong className="font-medium text-foreground">awaiting guidance</strong>{" "}
          in Kognitos. Use the state, reason, and steps below to move each run toward
          completion.
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
                  <p className="text-xs text-muted-foreground">
                    Run reference: {item.runId}
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
