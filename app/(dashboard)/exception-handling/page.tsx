"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import { ExternalLink, Inbox, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type {
  ExceptionDetailBundleDto,
  ExceptionEventDto,
  ExceptionSummaryDto,
} from "@/lib/kognitos/exception-view-model";
import { cn } from "@/lib/utils";

type StateFilterParam =
  | "pending"
  | "archived"
  | "resolved"
  | "non_resolved";

const STATE_OPTIONS: { value: StateFilterParam; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "archived", label: "Archived" },
  { value: "resolved", label: "Resolved" },
  { value: "non_resolved", label: "All non-resolved" },
];

function stateBadgeVariant(
  s: ExceptionSummaryDto["state"],
): "default" | "secondary" | "outline" | "destructive" {
  if (s === "PENDING") return "destructive";
  if (s === "ARCHIVED") return "secondary";
  if (s === "RESOLVED") return "outline";
  return "secondary";
}

function DetailSection({
  title,
  sectionId,
  children,
}: {
  title: string;
  sectionId: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 px-3 py-2.5" aria-labelledby={sectionId}>
      <h2
        id={sectionId}
        className="text-muted-foreground mb-2 text-[10px] font-semibold uppercase tracking-wide"
      >
        {title}
      </h2>
      <div className="min-w-0 space-y-2">{children}</div>
    </section>
  );
}

export default function ExceptionHandlingPage() {
  const [stateFilter, setStateFilter] = useState<StateFilterParam>("pending");
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [items, setItems] = useState<ExceptionSummaryDto[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ExceptionDetailBundleDto | null>(null);

  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const loadList = useCallback(
    async (opts?: { pageToken?: string | null; append?: boolean }) => {
      setListLoading(true);
      setListError(null);
      try {
        const params = new URLSearchParams();
        params.set("state", stateFilter);
        params.set("page_size", "50");
        if (opts?.pageToken) params.set("page_token", opts.pageToken);
        const res = await fetch(`/api/kognitos/exceptions?${params}`);
        const data = (await res.json()) as {
          items?: ExceptionSummaryDto[];
          nextPageToken?: string | null;
          error?: string;
        };
        if (!res.ok) {
          setListError(data.error ?? res.statusText);
          setItems([]);
          setNextPageToken(null);
          return;
        }
        const next = data.items ?? [];
        if (opts?.append) {
          setItems((prev) => [...prev, ...next]);
        } else {
          setItems(next);
          if (!opts?.pageToken && next.length > 0) {
            setSelectedId((cur) => cur ?? next[0]!.exceptionId);
          }
        }
        setNextPageToken(data.nextPageToken ?? null);
      } catch (e) {
        setListError(e instanceof Error ? e.message : "load_failed");
        setItems([]);
        setNextPageToken(null);
      } finally {
        setListLoading(false);
      }
    },
    [stateFilter],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setReplyText("");
    setReplyError(null);
    try {
      const res = await fetch(
        `/api/kognitos/exceptions/${encodeURIComponent(id)}`,
      );
      const data = (await res.json()) as ExceptionDetailBundleDto & {
        error?: string;
      };
      if (!res.ok) {
        setBundle(null);
        setDetailError(data.error ?? res.statusText);
        return;
      }
      setBundle(data);
    } catch (e) {
      setBundle(null);
      setDetailError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setBundle(null);
  }, [selectedId, loadDetail]);

  async function submitReply() {
    if (!selectedId || !replyText.trim()) return;
    setReplyBusy(true);
    setReplyError(null);
    try {
      const res = await fetch(
        `/api/kognitos/exceptions/${encodeURIComponent(selectedId)}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: replyText.trim() }),
        },
      );
      const data = (await res.json()) as {
        error?: string;
        hint?: string;
      };
      if (!res.ok) {
        const base = data.error ?? res.statusText;
        setReplyError(data.hint ? `${base}\n\n${data.hint}` : base);
        return;
      }
      setReplyText("");
      await new Promise((r) => setTimeout(r, 1500));
      await loadDetail(selectedId);
    } catch (e) {
      setReplyError(e instanceof Error ? e.message : "reply_failed");
    } finally {
      setReplyBusy(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-6rem)] flex-col gap-4 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-3 lg:max-w-[min(100%,52rem)]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Exception handling
            </h1>
            <p className="text-muted-foreground text-sm">
              Workspace exceptions (Kognitos). Use the table to triage; detail
              and reply on the right.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">State</Label>
              <Select
                value={stateFilter}
                onValueChange={(v) => {
                  setStateFilter(v as StateFilterParam);
                  setSelectedId(null);
                }}
              >
                <SelectTrigger className="h-8 w-[11.5rem] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={listLoading}
              onClick={() => void loadList()}
            >
              {listLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              <span className="ml-1.5">Refresh</span>
            </Button>
          </div>
        </div>

        {listError ? (
          <p className="text-destructive text-sm">{listError}</p>
        ) : null}

        <div className="bg-card overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[5.5rem] py-2 pl-3 text-xs font-medium">
                  State
                </TableHead>
                <TableHead className="w-[6.5rem] py-2 text-xs font-medium">
                  Group
                </TableHead>
                <TableHead className="py-2 text-xs font-medium">Summary</TableHead>
                <TableHead className="w-[7.5rem] py-2 text-xs font-medium">
                  Automation
                </TableHead>
                <TableHead className="w-[6rem] py-2 text-xs font-medium">Run</TableHead>
                <TableHead className="w-[5.5rem] py-2 pr-3 text-right text-xs font-medium">
                  When
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listLoading && items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-muted-foreground py-8 text-center text-sm"
                  >
                    <Loader2 className="mx-auto mb-2 size-5 animate-spin" />
                    Loading…
                  </TableCell>
                </TableRow>
              ) : null}
              {!listLoading && items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-muted-foreground py-8 text-center text-sm"
                  >
                    No exceptions for this filter.
                  </TableCell>
                </TableRow>
              ) : null}
              {items.map((row) => {
                const selected = row.exceptionId === selectedId;
                return (
                  <TableRow
                    key={row.exceptionId}
                    data-state={selected ? "selected" : undefined}
                    aria-selected={selected}
                    className={cn(
                      "cursor-pointer border-l-[3px] border-l-transparent transition-colors",
                      "odd:bg-muted/25",
                      "hover:bg-muted/55",
                      selected &&
                        "border-l-primary bg-primary/[0.09] hover:bg-primary/[0.11]",
                    )}
                    onClick={() => setSelectedId(row.exceptionId)}
                  >
                    <TableCell className="py-1.5 pl-3 align-middle">
                      <Badge
                        variant={stateBadgeVariant(row.state)}
                        className="text-[10px] font-normal tabular-nums"
                      >
                        {row.state}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-1.5 align-middle">
                      <span className="text-muted-foreground block truncate font-mono text-[11px] leading-tight">
                        {row.groupLabel}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-0 py-1.5 align-middle">
                      <span
                        className={cn(
                          "block truncate text-xs leading-snug",
                          selected && "font-medium text-foreground",
                        )}
                        title={row.title}
                      >
                        {row.title}
                      </span>
                    </TableCell>
                    <TableCell className="py-1.5 align-middle">
                      <span
                        className="text-muted-foreground block truncate text-[11px] leading-tight"
                        title={row.automationDisplayName ?? row.automationId}
                      >
                        {row.automationDisplayName ?? row.automationId}
                      </span>
                    </TableCell>
                    <TableCell className="py-1.5 align-middle">
                      <span className="font-mono text-[11px] text-foreground/90">
                        {row.runId ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap py-1.5 pr-3 text-right align-middle text-[11px] tabular-nums">
                      {row.createTime
                        ? formatDistanceToNow(new Date(row.createTime), {
                            addSuffix: true,
                          })
                        : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {nextPageToken ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start text-xs"
            disabled={listLoading}
            onClick={() => void loadList({ pageToken: nextPageToken, append: true })}
          >
            Load more
          </Button>
        ) : null}
      </div>

      <aside className="bg-card flex min-h-[20rem] w-full max-w-full min-w-0 flex-col overflow-hidden rounded-lg border lg:sticky lg:top-20 lg:max-h-[calc(100vh-8rem)] lg:w-[26rem] lg:max-w-[26rem] lg:shrink-0">
        {bundle ? (
          <div className="bg-muted/40 min-w-0 overflow-hidden border-b px-3 py-2.5">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0 flex-1 overflow-hidden">
                <div
                  className="text-muted-foreground block truncate font-mono text-[10px] leading-tight tracking-tight"
                  title={bundle.exception.exceptionId}
                >
                  {bundle.exception.exceptionId}
                </div>
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                  <Badge
                    variant={stateBadgeVariant(bundle.exception.state)}
                    className="max-w-full shrink-0 truncate text-[10px] font-normal"
                  >
                    {bundle.exception.state}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="max-w-full min-w-0 truncate font-mono text-[10px] font-normal"
                    title={bundle.exception.groupLabel}
                  >
                    {bundle.exception.groupLabel}
                  </Badge>
                </div>
              </div>
              {bundle.kognitosRunUrl ? (
                <Button variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs" asChild>
                  <a href={bundle.kognitosRunUrl} target="_blank" rel="noreferrer">
                    Run
                    <ExternalLink className="ml-1 size-3 opacity-70" />
                  </a>
                </Button>
              ) : null}
            </div>
            <dl className="text-muted-foreground mt-2 grid min-w-0 grid-cols-1 gap-x-3 gap-y-0.5 text-[11px] sm:grid-cols-[auto_minmax(0,1fr)]">
              {bundle.exception.executionId ? (
                <>
                  <dt className="min-w-0 font-medium text-foreground/80">Execution</dt>
                  <dd
                    className="min-w-0 truncate font-mono"
                    title={bundle.exception.executionId}
                  >
                    {bundle.exception.executionId}
                  </dd>
                </>
              ) : null}
              <dt className="min-w-0 font-medium text-foreground/80">Assignee</dt>
              <dd
                className="min-w-0 truncate font-mono"
                title={bundle.exception.assigneeShort ?? undefined}
              >
                {bundle.exception.assigneeShort ?? "—"}
              </dd>
              <dt className="min-w-0 font-medium text-foreground/80">Automation</dt>
              <dd
                className="min-w-0 truncate"
                title={
                  bundle.exception.automationDisplayName ??
                  bundle.exception.automationId
                }
              >
                {bundle.exception.automationDisplayName ?? bundle.exception.automationId}
              </dd>
              <dt className="min-w-0 font-medium text-foreground/80">Run</dt>
              <dd
                className="min-w-0 truncate font-mono"
                title={bundle.exception.runId ?? undefined}
              >
                {bundle.exception.runId ?? "—"}
              </dd>
            </dl>
          </div>
        ) : (
          <div className="text-muted-foreground flex items-center justify-between gap-2 border-b px-3 py-2 text-sm">
            <span>Detail</span>
          </div>
        )}

        <ScrollArea className="min-h-0 min-w-0 max-w-full flex-1">
          <div className="min-w-0 max-w-full overflow-x-hidden pb-0 text-sm">
            {!selectedId ? (
              <p className="text-muted-foreground px-3 py-4 text-xs">
                Select a row in the table to load exception detail.
              </p>
            ) : null}
            {detailLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 px-3 py-4 text-xs">
                <Loader2 className="size-4 animate-spin" />
                Loading detail…
              </div>
            ) : null}
            {detailError ? (
              <p className="text-destructive min-w-0 break-words px-3 py-3 text-xs">
                {detailError}
              </p>
            ) : null}
            {bundle ? (
              <>
                <DetailSection title="What happened" sectionId="sec-what">
                  {bundle.exception.descriptionFull ? (
                    <p className="text-foreground min-w-0 break-words text-xs leading-relaxed">
                      {bundle.exception.descriptionFull}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-xs italic">
                      No service description on this exception.
                    </p>
                  )}
                  <div className="min-w-0 max-w-full">
                    <p className="text-muted-foreground mb-1 text-[10px] font-medium uppercase tracking-wide">
                      Interpreter message
                    </p>
                    <div className="min-w-0 max-w-full overflow-x-auto overflow-y-hidden rounded border ring-1 ring-border/60">
                      <pre
                        className="bg-muted/80 text-foreground/90 max-h-28 min-w-0 max-w-full overflow-y-auto p-2 font-mono text-[10px] leading-snug whitespace-pre-wrap break-all [overflow-wrap:anywhere]"
                        tabIndex={0}
                      >
                        {bundle.exception.messageFull.trim()
                          ? bundle.exception.messageFull
                          : "—"}
                      </pre>
                    </div>
                  </div>
                </DetailSection>
                <Separator />
                <DetailSection title="Where it happened" sectionId="sec-where">
                  <p className="min-w-0 break-words font-mono text-[11px] leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">
                    {bundle.exception.locationDisplay}
                  </p>
                </DetailSection>
                <Separator />
                <DetailSection title="Triage context" sectionId="sec-triage">
                  {!bundle.runContext.foundInDb ? (
                    <p className="text-muted-foreground min-w-0 break-words text-xs leading-snug">
                      No matching run in this app’s database (sync may be missing
                      for this run id).
                    </p>
                  ) : (
                    <dl className="grid min-w-0 gap-x-2 gap-y-1 text-xs">
                      {bundle.runContext.keyValues.map((kv) => (
                        <div
                          key={kv.label}
                          className="grid min-w-0 grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)] gap-x-2 border-b border-border/50 py-1 last:border-0"
                        >
                          <dt className="text-muted-foreground shrink-0 font-medium">
                            {kv.label}
                          </dt>
                          <dd className="min-w-0 break-words font-medium leading-snug [overflow-wrap:anywhere]">
                            {kv.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {bundle.runContext.inputFiles.length > 0 ? (
                    <div className="min-w-0">
                      <p className="text-muted-foreground mb-1 text-[10px] font-medium uppercase tracking-wide">
                        Input files
                      </p>
                      <ul className="min-w-0 space-y-0.5 font-mono text-[10px] leading-tight">
                        {bundle.runContext.inputFiles.map((f, i) => (
                          <li
                            key={`${f.inputKey}:${f.kognitosFileId ?? ""}:${f.fileName ?? ""}:${i}`}
                            className="min-w-0 break-all [overflow-wrap:anywhere]"
                            title={`${f.inputKey}: ${f.fileName ?? f.kognitosFileId ?? "file"}`}
                          >
                            <span className="text-muted-foreground">{f.inputKey}:</span>{" "}
                            {f.fileName ?? f.kognitosFileId ?? "file"}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </DetailSection>
                <Separator />
                <DetailSection title="Resolution thread" sectionId="sec-events">
                  {!bundle.eventsAgentIdUsed ? (
                    <p className="text-muted-foreground min-w-0 break-words text-[10px] leading-snug [overflow-wrap:anywhere]">
                      Resolution events could not be loaded from Kognitos (check
                      base URL, credentials, and org/workspace scope).
                    </p>
                  ) : null}
                  <EventList
                    events={bundle.events}
                    agentResolved={Boolean(bundle.eventsAgentIdUsed)}
                  />
                </DetailSection>

                <div className="bg-muted/25 min-w-0 border-t px-3 py-3">
                  <h2 className="text-foreground mb-0.5 text-xs font-semibold">
                    Send guidance
                  </h2>
                  <p className="text-muted-foreground mb-2 min-w-0 break-words text-[10px] leading-snug">
                    Sends your message via the exception reply API. Processing is
                    asynchronous — after sending, wait a few seconds and use
                    Refresh if needed.
                  </p>
                  <Textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Instructions or answers for the resolution agent…"
                    rows={3}
                    className="min-w-0 max-w-full resize-y bg-background text-xs"
                    disabled={replyBusy}
                  />
                  {replyError ? (
                    <p className="text-destructive mt-1.5 min-w-0 whitespace-pre-wrap break-words text-xs">
                      {replyError}
                    </p>
                  ) : null}
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 min-w-[7.5rem]"
                      disabled={replyBusy || !replyText.trim()}
                      onClick={() => void submitReply()}
                    >
                      {replyBusy ? (
                        <>
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                          Sending…
                        </>
                      ) : (
                        "Send to agent"
                      )}
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </ScrollArea>
      </aside>
    </div>
  );
}

function EventList({
  events,
  agentResolved,
}: {
  events: ExceptionEventDto[];
  agentResolved: boolean;
}) {
  if (events.length === 0) {
    return (
      <div className="border-border bg-muted/30 text-muted-foreground min-w-0 rounded-md border border-dashed px-3 py-4 text-center">
        <Inbox className="text-foreground/35 mx-auto mb-2 size-7" aria-hidden />
        <p className="text-foreground text-xs font-medium">No thread events</p>
        <p className="mt-1.5 min-w-0 break-words text-[11px] leading-relaxed [overflow-wrap:anywhere]">
          {agentResolved
            ? "The resolution agent has not recorded any messages for this exception yet, or the thread is still initializing."
            : "Configure an exception-resolution agent id to load the event stream from Kognitos."}
        </p>
      </div>
    );
  }
  return (
    <ul className="border-border min-w-0 space-y-2.5 border-l-2 border-l-border/80 pl-2.5">
      {events.map((ev, i) => (
        <li key={`${ev.createTime ?? i}-${i}`} className="min-w-0 text-xs">
          <div className="text-muted-foreground mb-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 font-mono text-[10px]">
            <span className="min-w-0 max-w-full shrink break-all tabular-nums">
              {ev.createTime
                ? new Date(ev.createTime).toLocaleString()
                : "—"}
            </span>
            <Badge
              variant="secondary"
              className="h-4 max-w-full min-w-0 shrink truncate px-1 text-[9px] font-normal"
              title={ev.kind}
            >
              {ev.kind}
            </Badge>
          </div>
          <div className="text-foreground/95 min-w-0 break-words leading-snug [overflow-wrap:anywhere]">
            {ev.summary}
          </div>
          {ev.detail && ev.detail !== ev.summary ? (
            <div className="mt-1 min-w-0 max-w-full overflow-x-auto rounded border border-border/60">
              <pre className="bg-muted/60 max-h-20 min-w-0 max-w-full overflow-y-auto p-1.5 font-mono text-[10px] leading-snug whitespace-pre-wrap break-all">
                {ev.detail}
              </pre>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
