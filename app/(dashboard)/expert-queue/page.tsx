"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { formatDistanceToNow } from "date-fns";
import { ExternalLink, LifeBuoy, Loader2, MoreVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Card,
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
  EXPERT_QUEUE_VALIDATION_TAG_LABEL,
  type ExpertQueueIssueBadge,
  type ExpertQueueRow,
  type ExpertQueueValidationTag,
} from "@/lib/kognitos/expert-queue-issue";
import { InvoicePdfHighlightViewer } from "@/components/kognitos/invoice-pdf-highlight-viewer";
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
  "border-sky-200/80 bg-sky-50 text-sky-800 dark:border-sky-800/60 dark:bg-sky-950/50 dark:text-sky-100";

const VALIDATION_TAG_BADGE_CLASS: Record<ExpertQueueValidationTag, string> = {
  document_mismatch:
    "border-slate-300/90 bg-slate-50 text-slate-900 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100",
  coa_mismatch:
    "border-violet-300/90 bg-violet-50 text-violet-950 dark:border-violet-700/50 dark:bg-violet-950/40 dark:text-violet-100",
  value_mismatch:
    "border-amber-300/90 bg-amber-50 text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/35 dark:text-amber-100",
  quantity_mismatch:
    "border-sky-300/90 bg-sky-50 text-sky-950 dark:border-sky-700/50 dark:bg-sky-950/40 dark:text-sky-100",
};

const ISSUE_BADGE_CLASS: Record<ExpertQueueIssueBadge, string> = {
  po_not_found: MISSING_DETAILS_BADGE_CLASS,
  posting_date:
    "border-sky-200/80 bg-sky-50 text-sky-700 dark:border-sky-700/50 dark:bg-sky-950/45 dark:text-sky-100",
  book: "border-emerald-200/80 bg-emerald-50 text-emerald-900 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-100",
  missing_invoice_number:
    "border-cyan-200/80 bg-cyan-50 text-cyan-950 dark:border-cyan-800/50 dark:bg-cyan-950/45 dark:text-cyan-100",
  missing_po_number:
    "border-rose-200/80 bg-rose-50 text-rose-950 dark:border-rose-800/50 dark:bg-rose-950/40 dark:text-rose-100",
  missing_details: MISSING_DETAILS_BADGE_CLASS,
  sap_permissions_required:
    "border-purple-200/80 bg-purple-50 text-purple-950 dark:border-purple-800/50 dark:bg-purple-950/45 dark:text-purple-100",
  invalid_po_format:
    "border-orange-200/80 bg-orange-50 text-orange-950 dark:border-orange-800/50 dark:bg-orange-950/40 dark:text-orange-100",
  other:
    "border-muted-foreground/25 bg-muted/50 text-muted-foreground dark:bg-muted/30",
};

const invoiceValueFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Presence of an entry = pinned; `rank` is order within pinned (1 = top of pinned block). */
const EXPERT_QUEUE_PIN_STORAGE_KEY = "p2p_ent_expert_queue_pins_v1";

type ExpertQueuePinMap = Record<string, { rank: number }>;

function loadExpertQueuePins(): ExpertQueuePinMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(EXPERT_QUEUE_PIN_STORAGE_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object" || Array.isArray(p)) return {};
    return p as ExpertQueuePinMap;
  } catch {
    return {};
  }
}

function persistExpertQueuePins(next: ExpertQueuePinMap) {
  try {
    localStorage.setItem(EXPERT_QUEUE_PIN_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}

function compareExpertQueueRowsClient(a: ExpertQueueRow, b: ExpertQueueRow): number {
  const ta =
    Date.parse(a.updateTime ?? a.createTime ?? "") || Number.NEGATIVE_INFINITY;
  const tb =
    Date.parse(b.updateTime ?? b.createTime ?? "") || Number.NEGATIVE_INFINITY;
  if (tb !== ta) return tb - ta;
  return b.runId.localeCompare(a.runId);
}

function sortExpertQueueItemsWithPins(
  rows: ExpertQueueRow[],
  pins: ExpertQueuePinMap,
): ExpertQueueRow[] {
  const rankFor = (runId: string): number | null => {
    const e = pins[runId];
    if (!e) return null;
    const r = Math.floor(Number(e.rank));
    return Number.isFinite(r) && r > 0 ? r : 1;
  };
  const pinned = rows.filter((r) => rankFor(r.runId) != null);
  const unpinned = rows.filter((r) => rankFor(r.runId) == null);
  pinned.sort((a, b) => {
    const ra = rankFor(a.runId)!;
    const rb = rankFor(b.runId)!;
    if (ra !== rb) return ra - rb;
    return compareExpertQueueRowsClient(a, b);
  });
  unpinned.sort(compareExpertQueueRowsClient);
  return [...pinned, ...unpinned];
}

function ExpertQueuePinMenu({
  runId,
  pins,
  onPinsChange,
}: {
  runId: string;
  pins: ExpertQueuePinMap;
  onPinsChange: (next: ExpertQueuePinMap) => void;
}) {
  const pinned = Boolean(pins[runId]);
  const [open, setOpen] = useState(false);
  const [draftRank, setDraftRank] = useState("1");

  const apply = (next: ExpertQueuePinMap) => {
    onPinsChange(next);
  };

  const setPinned = (nextPinned: boolean) => {
    const next = { ...pins };
    if (!nextPinned) {
      delete next[runId];
    } else {
      const r = Math.max(1, Math.floor(Number(draftRank)) || 1);
      next[runId] = { rank: r };
    }
    apply(next);
    if (nextPinned) setDraftRank(String(next[runId]?.rank ?? 1));
  };

  const commitRankFromDraft = () => {
    if (!pins[runId]) return;
    const n = Math.max(1, Math.floor(Number(draftRank)) || 1);
    setDraftRank(String(n));
    apply({ ...pins, [runId]: { rank: n } });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setDraftRank(String(pins[runId]?.rank ?? 1));
        } else if (pins[runId]) {
          commitRankFromDraft();
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "absolute right-2 top-2 z-[1] rounded-md p-1 text-muted-foreground/25",
            "transition-colors hover:bg-muted/40 hover:text-muted-foreground/60",
            "group-hover:text-muted-foreground/40",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          )}
          aria-label="Item options"
        >
          <MoreVertical className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-56 space-y-3 p-3 text-sm"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2">
          <Checkbox
            id={`eq-pin-${runId}`}
            checked={pinned}
            onCheckedChange={(v) => setPinned(v === true)}
            className="border-muted-foreground/40"
          />
          <Label
            htmlFor={`eq-pin-${runId}`}
            className="cursor-pointer text-xs font-normal leading-snug text-foreground"
          >
            Pin to top
          </Label>
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor={`eq-rank-${runId}`}
            className="text-xs font-normal text-muted-foreground"
          >
            Rank (within pinned)
          </Label>
          <Input
            id={`eq-rank-${runId}`}
            type="number"
            min={1}
            step={1}
            disabled={!pinned}
            value={draftRank}
            onChange={(e) => setDraftRank(e.target.value)}
            onBlur={() => {
              if (pins[runId]) commitRankFromDraft();
            }}
            className="h-8 text-xs tabular-nums disabled:opacity-50"
          />
          <p className="text-[10px] leading-snug text-muted-foreground">
            Lower numbers appear first among pinned items. New items at 1 go to
            the top of the pinned block.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function highlightInlinePhrases(s: string): ReactNode {
  const re = /(company code\s+\d+)|(\b\d{1,2}\.\d{1,2}\.\d{4}\b)/gi;
  const nodes: ReactNode[] = [];
  let last = 0;
  const r = new RegExp(re.source, re.flags);
  let m: RegExpExecArray | null;
  while ((m = r.exec(s)) !== null) {
    if (m.index > last) nodes.push(s.slice(last, m.index));
    nodes.push(
      <strong key={`${m.index}-${m[0]}`} className="font-semibold text-foreground">
        {m[0]}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < s.length) nodes.push(s.slice(last));
  return nodes.length > 0 ? nodes : s;
}

function WhySummaryBody({ text }: { text: string }) {
  const chunks = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p className="text-sm leading-relaxed text-foreground">
      {chunks.map((chunk, i) => {
        const bold = chunk.match(/^\*\*([^*]+)\*\*$/);
        if (bold) {
          return (
            <strong key={i} className="font-semibold text-foreground">
              {bold[1]}
            </strong>
          );
        }
        return (
          <Fragment key={i}>{highlightInlinePhrases(chunk)}</Fragment>
        );
      })}
    </p>
  );
}

/** Company line on queue tiles: vendor only; never automation titles like “P2P 4-Way Match”. */
function companyNameForExpertQueueTile(vendor: string): string {
  const v = vendor.trim();
  if (!v || v === "—") return "";
  if (/^p2p\s*4[-\s]?way\s*match$/i.test(v)) return "";
  return v;
}

function RelativeQueueTime({ iso }: { iso: string | null }) {
  if (!iso) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <span className="text-xs text-muted-foreground">
      {formatDistanceToNow(d, { addSuffix: true })}
    </span>
  );
}

export default function ExpertQueuePage() {
  const [items, setItems] = useState<ExpertQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pins, setPins] = useState<ExpertQueuePinMap>({});
  const [invoiceViewer, setInvoiceViewer] = useState<{
    runId: string;
    pdfUrl: string;
  } | null>(null);

  useEffect(() => {
    setPins(loadExpertQueuePins());
  }, []);

  const sortedItems = useMemo(
    () => sortExpertQueueItemsWithPins(items, pins),
    [items, pins],
  );

  const handlePinsChange = useCallback((next: ExpertQueuePinMap) => {
    persistExpertQueuePins(next);
    setPins(next);
  }, []);

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
      } catch {
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
        <p className="mt-1 text-muted-foreground">Items awaiting expert guidance.</p>
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
        {sortedItems.map((item, index) => {
          const companyTitle = companyNameForExpertQueueTile(item.vendor);
          const showIssueCategoryBadge = !(
            item.issueBadge === "other" &&
            (item.validationTags?.length ?? 0) > 0
          );
          return (
            <article
              key={item.runId}
              className={cn(
                "group flex overflow-hidden rounded-xl border border-border bg-background shadow-sm",
                "transition-[box-shadow,transform,border-color] duration-200 ease-out",
                "hover:-translate-y-px hover:border-border hover:shadow-md",
                "dark:bg-card",
              )}
            >
              <div
                className={cn(
                  "w-1.5 shrink-0 bg-muted-foreground/20",
                  "transition-colors duration-200 ease-out",
                  "group-hover:bg-red-600 dark:bg-muted-foreground/30 dark:group-hover:bg-red-500",
                )}
                aria-hidden
              />
              <div className="relative min-w-0 flex-1 pr-7 pl-4 pt-4 pb-4 sm:pr-8 sm:pl-5 sm:pt-5 sm:pb-5">
                <ExpertQueuePinMenu
                  runId={item.runId}
                  pins={pins}
                  onPinsChange={handlePinsChange}
                />
                <div className="flex flex-wrap items-start justify-between gap-3 gap-y-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
                    <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    {showIssueCategoryBadge ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                          ISSUE_BADGE_CLASS[item.issueBadge],
                        )}
                      >
                        {ISSUE_BADGE_LABEL[item.issueBadge]}
                      </Badge>
                    ) : null}
                    {item.validationTags?.map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                          VALIDATION_TAG_BADGE_CLASS[tag],
                        )}
                      >
                        {EXPERT_QUEUE_VALIDATION_TAG_LABEL[tag]}
                      </Badge>
                    ))}
                    {companyTitle ? (
                      <h2 className="min-w-0 max-w-[min(100%,28rem)] truncate text-base font-normal tracking-tight text-foreground sm:text-lg">
                        {companyTitle}
                      </h2>
                    ) : null}
                  </div>
                  <div className="flex w-full shrink-0 flex-col items-start gap-1 sm:w-auto sm:items-end">
                    <RelativeQueueTime iso={item.updateTime ?? item.createTime} />
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {item.invoicePdfUrl || item.hasInvoiceDocumentInput ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg border-border bg-background px-3 text-xs font-medium shadow-none"
                          onClick={() => {
                            if (item.invoicePdfUrl) {
                              setInvoiceViewer({
                                runId: item.runId,
                                pdfUrl: item.invoicePdfUrl,
                              });
                            } else {
                              window.alert(
                                "No invoice file could be resolved for this run, or Kognitos file download is not configured in the app.",
                              );
                            }
                          }}
                        >
                          Invoice
                        </Button>
                      ) : null}
                      {item.kognitosRunUrl ? (
                        <a
                          href={item.kognitosRunUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                        >
                          Open Run
                          <ExternalLink className="size-3.5 shrink-0 opacity-80" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <WhySummaryBody text={item.whySummary} />
                </div>

                <div className="mt-5 border-t border-border/70 pt-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <p className="min-w-0">
                          <span className="text-muted-foreground">Invoice </span>
                          <span className="text-foreground">
                            {item.invoiceNumber}
                          </span>
                        </p>
                        <p className="min-w-0 break-all text-xs text-muted-foreground">
                          <span className="text-muted-foreground">Run ID </span>
                          <span className="font-mono text-foreground/90">
                            {item.runId}
                          </span>
                        </p>
                      </div>
                      <p>
                        <span className="text-muted-foreground">Value </span>
                        <span className="text-foreground">
                          {invoiceValueFmt.format(item.value)}
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-lg border-border bg-background font-normal shadow-none"
                      >
                        Skip for now
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-lg border-border bg-background font-bold shadow-none"
                      >
                        Provide guidance
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <Dialog
        open={invoiceViewer != null}
        onOpenChange={(open) => {
          if (!open) setInvoiceViewer(null);
        }}
      >
        <DialogContent
          centerFlex
          showCloseButton
          className="flex h-[min(82.8vh,828px)] w-[min(88.2vw,82.8rem)] max-w-[min(88.2vw,82.8rem)] flex-col gap-0 overflow-hidden border border-white/[0.08] bg-zinc-900 p-0 text-zinc-100 shadow-xl shadow-black/20 sm:max-w-[min(88.2vw,82.8rem)] [&_[data-slot=dialog-close]]:text-zinc-400 [&_[data-slot=dialog-close]]:hover:text-zinc-100"
        >
          <DialogHeader className="shrink-0 border-b border-white/[0.07] bg-zinc-900 px-4 py-2 text-left">
            <DialogTitle className="text-base font-medium text-zinc-50">
              Document Processing
            </DialogTitle>
          </DialogHeader>
          {invoiceViewer ? (
            <InvoicePdfHighlightViewer
              pdfUrl={invoiceViewer.pdfUrl}
              runId={invoiceViewer.runId}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
