"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  Archive as ArchiveIcon,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  FileText,
  Info,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import {
  type ExceptionDetailBundleDto,
  type ExceptionEventDto,
  type ExceptionStateUi,
  type ExceptionStructuredChoiceDto,
  type ExceptionSummaryDto,
} from "@/lib/kognitos/exception-view-model";
import {
  applyMessageUpdate,
  messagesFromEvents,
  type ChatDocumentPreviewData,
  type ChatFormField,
  type ChatFormFieldsData,
  type ChatMessageDto,
  type ChatSystemErrorMessage,
  type ChatTextMessage,
  type ChatThinkingMessage,
  type ChatToolCallMessage,
  type ChatWidget,
} from "@/lib/kognitos/chat-event-reducer";
import {
  useExceptionStream,
  type ExceptionStreamStatus,
} from "@/lib/kognitos/use-exception-stream";
import {
  buildEditFactsXml,
  buildEditFactsXmlFromRelatedOutputs,
  type BuildEditFactInput,
  type EditedFact,
  type ParsedFact,
  type ParsedGuideEntry,
  type ParsedRelatedOutputs,
  type RelatedOutputsContext,
} from "@/lib/kognitos/astral-chat-xml";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InvoicePdfHighlightViewer } from "@/components/kognitos/invoice-pdf-highlight-viewer";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

type StateFilterParam = "pending" | "resolved" | "archived" | "non_resolved";

/**
 * Subset of {@link ChatMessageDto} that the v2 chat surface knows how to
 * render. We deliberately drop `system-completion` (no UI value: we already
 * show "agent is thinking" indicators while a turn is in flight, and a
 * separate completion line would just add noise).
 */
type VisibleMessage =
  | ChatTextMessage
  | ChatThinkingMessage
  | ChatToolCallMessage
  | ChatSystemErrorMessage;

/**
 * Args for the rich-PDF branch of {@link ChatDocumentViewerOpen}.
 * The page mounts an {@link InvoicePdfHighlightViewer} dialog with these
 * values — same component the dashboard runs-analyzed table uses
 * (PDF + bounding-box overlays + per-field confidence panel).
 */
type ChatPdfViewerOpen = {
  pdfUrl: string;
  runId: string;
  label: string;
};

/**
 * Args for the in-app image-preview branch of
 * {@link ChatDocumentViewerOpen}. Used when the agent surfaces an image
 * attachment (PNG/JPG/GIF/WebP/SVG) — opens in a modal so the user stays
 * in the dashboard context, instead of an OS-level browser popup.
 */
type ChatImagePreviewOpen = {
  url: string;
  label: string;
  mimeType?: string | null;
};

/**
 * Discriminated union passed to `onOpenDocumentViewer` when the user
 * clicks a chat document-preview widget. The page-level handler routes
 * PDFs to the highlight viewer and images to a lightweight modal —
 * either way, the click stays inside the React app (no OS popup).
 *
 * Mirrors the same widget contract as
 * `app/(dashboard)/exception-handling` (v1) but with the union added so
 * images get a first-class in-app surface.
 */
type ChatDocumentViewerOpen =
  | ({ kind: "pdf" } & ChatPdfViewerOpen)
  | ({ kind: "image" } & ChatImagePreviewOpen);

type TabDef = { value: StateFilterParam; label: string };

const TABS: TabDef[] = [
  { value: "pending", label: "Needs review" },
  { value: "resolved", label: "Resolved" },
  { value: "archived", label: "Archived" },
  { value: "non_resolved", label: "All" },
];

const COUNT_BG: Record<StateFilterParam, string | null> = {
  pending: "#0071e3",
  resolved: "#34c759",
  archived: null,
  non_resolved: null,
};

const SEVERITY = {
  amber: "#f59e0b",
  red: "#ff3b30",
  blue: "#0071e3",
} as const;

type Severity = keyof typeof SEVERITY;

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function severityFor(row: { title: string; state: ExceptionStateUi }): Severity {
  const t = row.title.toLowerCase();
  if (
    /unable|failed|cannot|blocked|rejected|error/.test(t) ||
    row.state === "ARCHIVED"
  )
    return "red";
  if (/missing|required|not\s*found|needs|provide|extract/.test(t))
    return "amber";
  return "blue";
}

function shortAge(iso: string | null): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "—";
  }
}

/** Render text with `[bracketed]` segments turned into monospace red pills. */
function MonoBracketedText({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: Array<{ kind: "t" | "m"; v: string }> = [];
    const re = /\[([^\]\n]{1,80})\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push({ kind: "t", v: text.slice(last, m.index) });
      out.push({ kind: "m", v: m[1] });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ kind: "t", v: text.slice(last) });
    return out;
  }, [text]);

  return (
    <>
      {parts.map((p, i) =>
        p.kind === "m" ? (
          <span
            key={i}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              fontWeight: 500,
              background: "rgba(255,59,48,0.08)",
              color: "#b91c1c",
              borderRadius: 5,
              padding: "1px 5px",
            }}
          >
            {p.v}
          </span>
        ) : (
          <span key={i}>{p.v}</span>
        ),
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// Optimistic outgoing messages
// ─────────────────────────────────────────────────────────────────

const OPTIMISTIC_USER_PREFIX = "optimistic:user:";

function newOptimisticId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${OPTIMISTIC_USER_PREFIX}${crypto.randomUUID()}`;
  }
  return `${OPTIMISTIC_USER_PREFIX}${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function makeOptimisticUserMessage(content: string): ChatTextMessage {
  return {
    id: newOptimisticId(),
    kind: "text",
    role: "user",
    content,
    widgets: [],
    createTime: new Date().toISOString(),
    isStreaming: false,
    status: "sending",
  };
}

/**
 * Add `seconds` (which may be negative) to an ISO-8601 timestamp.
 * Used to widen the dedup window so small client/server clock skew
 * doesn't cause an outgoing optimistic bubble to miss matching its
 * server echo. Returns the original string if it can't be parsed.
 */
function addSecondsIso(iso: string, seconds: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t + seconds * 1000).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────
// Post-reply polling
//
// The Kognitos SSE stream (`events:stream`) is best-effort: in some
// dev/load conditions new turn events for a freshly-issued reply don't
// surface on the open stream until the next reconnect. Mirroring the
// production page, we belt-and-suspenders the SSE path with a short
// HTTP polling loop after every reply so the agent's response always
// renders, even if a single SSE event is dropped.
//
// The loop:
//   1. Wait `POST_REPLY_DELAY_MS` so the server has a chance to enqueue
//      the user echo and start an agent turn.
//   2. Re-fetch the bundle every `POLL_INTERVAL_MS`.
//   3. Stop early once the bundle stops changing for `POLL_IDLE_STOP_MS`
//      after the first observed change (typical settle), OR once
//      `POLL_MAX_MS` total wall-time has elapsed (safety cap).
// ─────────────────────────────────────────────────────────────────

const POST_REPLY_DELAY_MS = 1500;
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_MS = 50_000;
const POLL_IDLE_STOP_MS = 8_000;

type PollSnapshot = {
  eventCount: number;
  latestEventTime: string | null;
  state: ExceptionStateUi;
};

function eventLatestTime(events: ExceptionEventDto[]): string | null {
  let latest: string | null = null;
  for (const e of events) {
    if (!e.createTime) continue;
    if (!latest || e.createTime > latest) latest = e.createTime;
  }
  return latest;
}

function buildPollSnapshot(
  bundle: ExceptionDetailBundleDto | null,
): PollSnapshot {
  const events = bundle?.events ?? [];
  const ex = bundle?.exception;
  return {
    eventCount: events.length,
    latestEventTime: eventLatestTime(events),
    state: ex?.state ?? "UNKNOWN",
  };
}

function pollSnapshotChanged(
  snap: PollSnapshot,
  data: ExceptionDetailBundleDto,
): boolean {
  const ev = data.events;
  const latest = eventLatestTime(ev);
  if (ev.length > snap.eventCount) return true;
  if (latest && snap.latestEventTime && latest > snap.latestEventTime)
    return true;
  if (data.exception.state !== snap.state) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────
// Related-outputs widget helpers (mirrors production)
// ─────────────────────────────────────────────────────────────────

function relatedOutputsTitle(context: RelatedOutputsContext | null): string {
  if (context === "need_information") return "Information needed";
  if (context === "analyze_outputs") return "Analysis of extracted fields";
  if (context === "manual_action_required") return "Manual action required";
  return "Document fields";
}

function shortFactSourceLabel(source: string | undefined): string | null {
  if (!source) return null;
  const trimmed = source.trim();
  if (!trimmed) return null;
  const slashIdx = trimmed.lastIndexOf("/");
  return slashIdx >= 0 ? trimmed.slice(slashIdx + 1) : trimmed;
}

function relatedOutputsIdentityKey(data: ParsedRelatedOutputs): string {
  const parts = data.factGroups.map((g) => {
    const src = g.source?.name ?? "";
    const page = g.source?.page ?? "";
    const fields = g.facts.map((f) => `${f.field}:${f.status}`).join(",");
    return `${src}#${page}|${fields}`;
  });
  return `${data.context ?? ""}::${parts.join("||")}`;
}

function whatHappenedText(bundle: ExceptionDetailBundleDto | null): string {
  if (!bundle) return "";
  const ex = bundle.exception;
  return ex.descriptionFull || ex.messageFull || ex.title;
}

/**
 * Read the human-readable run status string out of `runContext.keyValues`.
 * Returns null when not present (eg. the bundle hasn't loaded the run row
 * from supabase yet, or the run resource was missing entirely).
 */
function runStatusFromBundle(
  bundle: ExceptionDetailBundleDto | null,
): string | null {
  if (!bundle) return null;
  const row = bundle.runContext.keyValues.find((kv) => kv.label === "Run status");
  if (!row) return null;
  const v = row.value?.trim();
  return v && v !== "—" ? v : null;
}

/**
 * Whether the run that owns this exception can be resumed via Kognitos
 * `ContinueRun`. Per Kognitos run-state semantics that's only true when
 * the run is paused waiting for operator input. We deliberately accept
 * `null` (= "we don't know yet") so we don't disable the button on
 * pre-bundle paint — the API will reject with a useful 4xx in that case.
 */
function isRunContinueable(status: string | null): boolean {
  if (!status) return true;
  return /awaiting\s*guidance/i.test(status);
}

function recommendedActionText(bundle: ExceptionDetailBundleDto | null): string {
  if (!bundle) return "";
  const ex = bundle.exception;
  const hay = `${ex.title} ${ex.descriptionFull ?? ""}`.toLowerCase();
  if (/purchase\s*order|\bpo\b|p\.o\./.test(hay)) {
    return "Provide the correct purchase order number, or confirm this invoice should be processed without a PO. Once provided, the resolution agent will continue automatically.";
  }
  if (/missing|required|not\s*found|invalid/.test(hay)) {
    return "Identify the missing or invalid field, correct it in source data or confirm the intended value, then tell the agent exactly what to use so the step can be retried safely.";
  }
  if (/timeout|unavailable|connection/.test(hay)) {
    return "Confirm whether the failure was transient. If so, retry; otherwise specify an alternate path or data source so the agent can continue without repeating the same failure.";
  }
  return "State the concrete correction or decision the agent should apply, then send guidance so the resolution agent can continue without guessing.";
}

function statusChip(state: ExceptionStateUi): { label: string; bg: string; fg: string; dot: string } {
  switch (state) {
    case "RESOLVED":
      return {
        label: "Resolved",
        bg: "rgba(52,199,89,0.10)",
        fg: "#166534",
        dot: "#34c759",
      };
    case "ARCHIVED":
      return {
        label: "Archived",
        bg: "rgba(118,118,128,0.12)",
        fg: "#3f3f46",
        dot: "#6e6e73",
      };
    case "PENDING":
    default:
      return {
        label: "Needs review",
        bg: "rgba(245,158,11,0.10)",
        fg: "#92400e",
        dot: "#f59e0b",
      };
  }
}

// ─────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────

export default function ExceptionHandlingV2Page() {
  const router = useRouter();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) router.replace("/login");
  }, [user, router]);

  // ── Data state ──
  const [stateFilter, setStateFilter] = useState<StateFilterParam>("pending");
  const [items, setItems] = useState<ExceptionSummaryDto[]>([]);
  /**
   * Pagination state. Kognitos uses opaque continuation tokens, so to
   * support Prev we keep a stack of every page-token we've used so far.
   * - `pageStack[0]` is always `null` (the first page has no token).
   * - `pageStack[pageStack.length - 1]` is the token of the page currently
   *   on screen, and `nextPageToken` (when non-null) lets us push forward.
   */
  const [pageStack, setPageStack] = useState<(string | null)[]>([null]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [resolvedCount, setResolvedCount] = useState<number | null>(null);
  const [searchText, setSearchText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ExceptionDetailBundleDto | null>(null);
  const [streamMessages, setStreamMessages] = useState<ChatMessageDto[]>([]);
  const [optimisticMessages, setOptimisticMessages] = useState<
    ChatTextMessage[]
  >([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  /**
   * Per-exception draft store. Keyed by `exceptionId`. Lets the user
   * switch rows mid-compose without losing their pending reply, and
   * keeps each draft scoped so it doesn't leak into another thread.
   */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [stopBusy, setStopBusy] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  /**
   * PDF-viewer dialog state. When non-null, mounts the same
   * {@link InvoicePdfHighlightViewer} the dashboard's runs-analyzed table
   * uses, giving us PDF + bounding-box overlays + per-field confidence
   * panel for any document the agent surfaces inline in the chat. Falls
   * back to a popup-window on attachments that lack a `runId` (no IDP
   * extraction available) — see {@link V2DocumentPreviewCard}.
   */
  const [documentViewer, setDocumentViewer] =
    useState<ChatPdfViewerOpen | null>(null);
  /**
   * Image-preview dialog state. When non-null, mounts a lightweight
   * in-app image viewer for non-PDF attachments (PNG/JPG/GIF/WebP/SVG).
   * Replaces the OS-level browser popup that v2 previously fell through
   * to for images, so the user keeps the dashboard's modal context.
   */
  const [imagePreview, setImagePreview] =
    useState<ChatImagePreviewOpen | null>(null);
  /**
   * Single entry point for chat document-preview clicks. Routes by `kind`
   * so V2DocumentPreviewCard never has to know which dialog to mount.
   */
  const handleOpenAttachment = useCallback(
    (args: ChatDocumentViewerOpen) => {
      if (args.kind === "pdf") {
        const { pdfUrl, runId, label } = args;
        setDocumentViewer({ pdfUrl, runId, label });
        return;
      }
      const { url, label, mimeType } = args;
      setImagePreview({ url, label, mimeType: mimeType ?? null });
    },
    [],
  );
  /**
   * Per-exception action state for the canned conversational shortcuts
   * ("Mark as resolved" / "Archive"). Keyed by `exceptionId` so switching
   * rows mid-flight doesn't visually interfere with another row's request.
   */
  const [pendingAction, setPendingAction] = useState<
    Record<string, "resolved" | "archived">
  >({});
  /**
   * Per-exception UI flags. Each map is keyed by `exceptionId` so the
   * operator's expand/collapse choices are remembered when they jump
   * between rows in a single session (no localStorage — these reset
   * on page refresh, which is the right behavior for triage workflow).
   */
  const [historyOpenMap, setHistoryOpenMap] = useState<Record<string, boolean>>({});
  const [contextOpenMap, setContextOpenMap] = useState<Record<string, boolean>>({});
  const [activityOpenMap, setActivityOpenMap] = useState<Record<string, boolean>>({});
  const historyOpen = selectedId ? Boolean(historyOpenMap[selectedId]) : false;
  const contextOpen = selectedId ? Boolean(contextOpenMap[selectedId]) : false;
  const activityOpen = selectedId ? Boolean(activityOpenMap[selectedId]) : false;
  const setOpenForSelected = useCallback(
    (
      setter: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
    ) =>
      () => {
        if (!selectedId) return;
        setter((prev) => {
          const next = { ...prev };
          if (prev[selectedId]) delete next[selectedId];
          else next[selectedId] = true;
          return next;
        });
      },
    [selectedId],
  );
  const toggleHistoryOpen = useMemo(
    () => setOpenForSelected(setHistoryOpenMap),
    [setOpenForSelected],
  );
  const toggleContextOpen = useMemo(
    () => setOpenForSelected(setContextOpenMap),
    [setOpenForSelected],
  );
  const toggleActivityOpen = useMemo(
    () => setOpenForSelected(setActivityOpenMap),
    [setOpenForSelected],
  );

  // When keyboard nav moves to a row that's offscreen in the list panel,
  // pull it into view. We do this from the page level (not the list)
  // because the list doesn't know that selection came from a keypress.
  useEffect(() => {
    if (!selectedId) return;
    const el = document.querySelector<HTMLElement>(
      `[data-row-id="${CSS.escape(selectedId)}"]`,
    );
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  /** Current draft for the active selection (empty string when none). */
  const replyText = selectedId ? (drafts[selectedId] ?? "") : "";

  const setReplyText = useCallback(
    (next: string) => {
      if (!selectedId) return;
      setDrafts((prev) => {
        // Drop empty drafts so the map doesn't accumulate noise across the session.
        if (next === "") {
          if (!(selectedId in prev)) return prev;
          const copy = { ...prev };
          delete copy[selectedId];
          return copy;
        }
        if (prev[selectedId] === next) return prev;
        return { ...prev, [selectedId]: next };
      });
    },
    [selectedId],
  );

  const cancelBusyRef = useRef(false);

  const bundleRef = useRef<ExceptionDetailBundleDto | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  /**
   * Monotonic id for the post-reply polling loop. Each new reply (and
   * each conversation switch / unmount) bumps this so older async
   * loops can detect they've been superseded and bail out.
   */
  const postReplyPollRunIdRef = useRef(0);
  useEffect(() => {
    bundleRef.current = bundle;
  }, [bundle]);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // ── Stream wiring ──
  const handleStreamEvents = useCallback((events: ExceptionEventDto[]) => {
    if (events.length === 0) return;
    setStreamMessages((prev) => {
      let next = prev;
      for (const e of events) next = applyMessageUpdate(next, e);
      return next;
    });
  }, []);

  /**
   * Polling fallback. When the stream exhausts its retries we start a
   * lightweight refetch loop on the detail bundle so the operator still
   * sees new messages within ~8 seconds. Cleared on selection change,
   * stream recovery, or unmount.
   */
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [streamFallbackError, setStreamFallbackError] = useState<string | null>(
    null,
  );
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const handleStreamFallback = useCallback((lastError: string) => {
    setStreamFallbackError(lastError || "stream_failed");
  }, []);

  /**
   * Snapshot of the merged chat message list. Read by `isStreamClosable`
   * inside the stream's grace timer, so we need a ref (not a closure) to
   * always see the most up-to-date list.
   */
  const chatMessagesRef = useRef<ChatMessageDto[]>([]);

  /**
   * Returns true when no client-side work remains — i.e. it's safe for the
   * stream to auto-close after the post-completion grace window. We block
   * close when:
   *   - any message is still `isStreaming` (partial agent_message / thinking
   *     snapshot waiting on its `STATE_COMPLETE` follow-up); or
   *   - any tool-call message has no matching result yet (waiting on a late
   *     `tool_call_result` to pair via `applyMessageUpdate`).
   * Mirrors the production page so we don't close the SSE socket out from
   * under an in-progress turn — which would drop the agent's reply for the
   * UI even though the bundle has it.
   */
  const isStreamClosable = useCallback(() => {
    const ms = chatMessagesRef.current;
    for (const m of ms) {
      if (m.isStreaming) return false;
      if (m.kind === "tool-call" && m.result === undefined) return false;
    }
    return true;
  }, []);

  const stream = useExceptionStream({
    onEvents: handleStreamEvents,
    onFallback: handleStreamFallback,
    closeOnCompletion: true,
    isClosable: isStreamClosable,
  });

  // ── Loaders ──
  /**
   * Fetch one page of exceptions. Returns the items and the server's
   * `nextPageToken` so the caller can stitch together a paged history
   * (we keep a stack of tokens in state so Prev navigates back).
   */
  const loadList = useCallback(
    async (
      filter: StateFilterParam,
      opts?: { pageToken?: string | null },
    ) => {
      setListLoading(true);
      setListError(null);
      try {
        const params = new URLSearchParams();
        params.set("state", filter);
        params.set("page_size", "50");
        if (opts?.pageToken) params.set("page_token", opts.pageToken);
        const res = await fetch(`/api/kognitos/exceptions?${params}`);
        const data = (await res.json()) as {
          items?: ExceptionSummaryDto[];
          nextPageToken?: string | null;
          error?: string;
          hint?: string;
        };
        if (!res.ok) {
          setListError(data.hint ?? data.error ?? res.statusText);
          setItems([]);
          setNextPageToken(null);
          return { items: [], nextPageToken: null as string | null };
        }
        const next = data.items ?? [];
        setItems(next);
        const nextTok = data.nextPageToken ?? null;
        setNextPageToken(nextTok);
        return { items: next, nextPageToken: nextTok };
      } catch (e) {
        setListError(e instanceof Error ? e.message : "list_failed");
        setItems([]);
        setNextPageToken(null);
        return { items: [], nextPageToken: null as string | null };
      } finally {
        setListLoading(false);
      }
    },
    [],
  );

  const fetchCount = useCallback(async (filter: StateFilterParam) => {
    try {
      const params = new URLSearchParams();
      params.set("state", filter);
      params.set("page_size", "100");
      const res = await fetch(`/api/kognitos/exceptions?${params}`);
      if (!res.ok) return 0;
      const data = (await res.json()) as { items?: ExceptionSummaryDto[] };
      return data.items?.length ?? 0;
    } catch {
      return 0;
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetch(
        `/api/kognitos/exceptions/${encodeURIComponent(id)}`,
      );
      const data = (await res.json()) as ExceptionDetailBundleDto & {
        error?: string;
        hint?: string;
      };
      if (!res.ok) {
        if (selectedIdRef.current === id) {
          setDetailError(data.hint ?? data.error ?? res.statusText);
          setBundle(null);
        }
        return null;
      }
      if (selectedIdRef.current === id) setBundle(data);
      return data;
    } catch (e) {
      if (selectedIdRef.current === id) {
        setDetailError(e instanceof Error ? e.message : "detail_failed");
        setBundle(null);
      }
      return null;
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // ── Effects ──
  useEffect(() => {
    let cancelled = false;
    // Reset pagination whenever the filter (tab) changes.
    setPageStack([null]);
    setNextPageToken(null);
    void (async () => {
      const { items: next } = await loadList(stateFilter);
      if (cancelled) return;
      if (next.length > 0) {
        setSelectedId((cur) =>
          cur && next.some((r) => r.exceptionId === cur)
            ? cur
            : next[0].exceptionId,
        );
      } else {
        setSelectedId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stateFilter, loadList]);

  useEffect(() => {
    void (async () => {
      const [p, r] = await Promise.all([
        fetchCount("pending"),
        fetchCount("resolved"),
      ]);
      setPendingCount(p);
      setResolvedCount(r);
    })();
  }, [fetchCount]);

  useEffect(() => {
    setStreamMessages([]);
    setOptimisticMessages([]);
    setReplyError(null);
    setDetailError(null);
    setRunError(null);
    setStreamFallbackError(null);
    stopPolling();
    // Invalidate any in-flight post-reply polling loop from the prior
    // conversation — it's bound to the previous exception id and would
    // otherwise keep refetching after we've moved on.
    postReplyPollRunIdRef.current += 1;
    if (selectedId) {
      void loadDetail(selectedId).then((b) => {
        if (b && selectedIdRef.current === selectedId) {
          stream.start(selectedId, {
            seedEventIds: (b.events ?? []).map((e) => e.id),
          });
        }
      });
    } else {
      setBundle(null);
      stream.stop();
    }
    return () => {
      stream.stop();
      stopPolling();
      postReplyPollRunIdRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Manage the polling interval based on stream status. We poll whenever
  // the SSE stream is in `fallback` AND a row is selected; we stop the
  // moment the stream returns to `connecting` / `open` (e.g. user-driven
  // reconnect) or selection clears.
  useEffect(() => {
    if (!selectedId || stream.status !== "fallback") {
      stopPolling();
      return;
    }
    if (pollIntervalRef.current) return;
    pollIntervalRef.current = setInterval(() => {
      const id = selectedIdRef.current;
      if (!id) return;
      void loadDetail(id);
    }, 8000);
    return () => {
      stopPolling();
    };
  }, [selectedId, stream.status, loadDetail, stopPolling]);

  // Clear the cached fallback banner once the stream recovers.
  useEffect(() => {
    if (stream.status !== "fallback") setStreamFallbackError(null);
  }, [stream.status]);

  /**
   * User-driven reconnect from the fallback banner. Re-seeds with the
   * current bundle's event ids so we don't re-trigger the auto-close
   * machine on history replay.
   */
  const reconnectStream = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    setStreamFallbackError(null);
    stopPolling();
    void loadDetail(id).then((b) => {
      if (selectedIdRef.current !== id) return;
      stream.start(id, {
        seedEventIds: (b?.events ?? []).map((e) => e.id),
      });
    });
  }, [loadDetail, stream, stopPolling]);

  /**
   * Pagination — navigate to the next page by pushing the current
   * `nextPageToken` onto the stack and refetching.
   */
  const goNextPage = useCallback(async () => {
    if (!nextPageToken || listLoading) return;
    const tok = nextPageToken;
    const { items: next } = await loadList(stateFilter, { pageToken: tok });
    setPageStack((prev) => [...prev, tok]);
    if (next.length > 0) setSelectedId(next[0].exceptionId);
    else setSelectedId(null);
  }, [nextPageToken, listLoading, loadList, stateFilter]);

  /**
   * Pagination — pop the top of the stack to land on the prior page.
   * `pageStack[0]` is the sentinel `null` for the first page so this
   * naturally turns into a no-op when already at the start.
   */
  const goPrevPage = useCallback(async () => {
    if (pageStack.length <= 1 || listLoading) return;
    const nextStack = pageStack.slice(0, -1);
    const tok = nextStack[nextStack.length - 1];
    const { items: next } = await loadList(stateFilter, { pageToken: tok });
    setPageStack(nextStack);
    if (next.length > 0) setSelectedId(next[0].exceptionId);
    else setSelectedId(null);
  }, [pageStack, listLoading, loadList, stateFilter]);

  // ── Derived ──
  const filteredItems = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return items;
    return items.filter((r) =>
      `${r.title} ${r.groupLabel} ${r.automationDisplayName ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [items, searchText]);

  /**
   * Merge order:
   *   1. Bundle (canonical snapshot from `/events:list`).
   *   2. Stream tail (events newer than the bundle's max createTime).
   *   3. Optimistic outgoing messages whose server echo hasn't arrived
   *      yet (content + timestamp matched against merged user events,
   *      with ~5s clock-skew tolerance).
   */
  const messages = useMemo<ChatMessageDto[]>(() => {
    const baseMessages = bundle ? messagesFromEvents(bundle.events) : [];
    const baseIds = new Set(baseMessages.map((m) => m.id));
    let baseMaxTime = "";
    for (const m of baseMessages) {
      if (m.createTime && m.createTime > baseMaxTime) baseMaxTime = m.createTime;
    }
    const merged: ChatMessageDto[] = [...baseMessages];
    for (const m of streamMessages) {
      if (baseIds.has(m.id)) continue;
      // Drop replayed historical events older than anything in the snapshot.
      if (baseMaxTime && m.createTime && m.createTime <= baseMaxTime) continue;
      const idx = merged.findIndex((x) => x.id === m.id);
      if (idx >= 0) merged[idx] = m;
      else merged.push(m);
    }
    // Dedup optimistic bubbles against everything we've merged so far.
    const knownUserBuckets = new Map<string, string>();
    for (const m of merged) {
      if (m.kind !== "text" || m.role !== "user") continue;
      const key = m.content.trim();
      const t = m.createTime ?? "";
      const cur = knownUserBuckets.get(key);
      if (cur === undefined || t > cur) knownUserBuckets.set(key, t);
    }
    for (const m of optimisticMessages) {
      const key = m.content.trim();
      const newest = knownUserBuckets.get(key);
      const optTime = m.createTime ?? "";
      // Time-scoped: only dedup when the server-side echo is at-or-after
      // the optimistic's own createTime (with 5s skew tolerance). This
      // lets the user re-send the same content twice in a row.
      if (newest !== undefined && newest >= addSecondsIso(optTime, -5)) continue;
      merged.push(m);
    }
    return merged;
  }, [bundle, streamMessages, optimisticMessages]);

  // Keep `chatMessagesRef` in sync so the stream's `isStreamClosable`
  // predicate (called from a setTimeout inside the hook) always sees the
  // newest merged list, not whatever closure was captured at hook-init.
  useEffect(() => {
    chatMessagesRef.current = messages;
  }, [messages]);

  // When the server snapshot updates, drop optimistic bubbles whose echo
  // has now landed in the bundle. Mirrors the production page.
  useEffect(() => {
    if (!bundle?.events) return;
    const newestUserTimeByContent = new Map<string, string>();
    for (const e of bundle.events) {
      if (e.kind !== "user") continue;
      const detail = (e.detail ?? "").trim();
      if (!detail) continue;
      const t = e.createTime ?? "";
      const cur = newestUserTimeByContent.get(detail);
      if (cur === undefined || t > cur) newestUserTimeByContent.set(detail, t);
    }
    setOptimisticMessages((prev) =>
      prev.filter((m) => {
        const newest = newestUserTimeByContent.get(m.content.trim());
        if (newest === undefined) return true;
        const optTime = m.createTime ?? "";
        return newest < addSecondsIso(optTime, -5);
      }),
    );
  }, [bundle?.events]);

  /**
   * Visible transcript — text bubbles plus thinking / tool-call / system-error
   * traces so the operator can see what the agent is doing between replies.
   * Slicing into latest-N + "earlier" is done by `DetailPanel` so the toggle
   * state lives next to the rendering.
   */
  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (m) =>
          m.kind === "text" ||
          m.kind === "thinking" ||
          m.kind === "tool-call" ||
          m.kind === "system-error",
      ),
    [messages],
  ) as VisibleMessage[];

  const isAgentWorking = useMemo(
    () =>
      messages.some(
        (m) =>
          (m.kind === "thinking" || m.kind === "tool-call") && m.isStreaming,
      ),
    [messages],
  );

  // ── Send pipeline ──
  /**
   * Send arbitrary content (free-text or pre-built XML payload) as a user
   * reply. Pushes an optimistic bubble immediately, then POSTs and re-arms
   * the stream. On failure the bubble switches to `failed` state and can
   * be retried inline.
   *
   * Returns true on success so widget callers (e.g. `RelatedOutputsCard`'s
   * Send) can show a success state.
   */
  const sendReplyMessage = useCallback(
    async (
      content: string,
      opts?: { clearReplyText?: boolean },
    ): Promise<boolean> => {
      const trimmed = content.trim();
      if (!trimmed || !selectedId || replyBusy) return false;
      setReplyBusy(true);
      setReplyError(null);
      const optimistic = makeOptimisticUserMessage(trimmed);
      setOptimisticMessages((prev) => [...prev, optimistic]);

      try {
        const res = await fetch(
          `/api/kognitos/exceptions/${encodeURIComponent(selectedId)}/reply`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: trimmed }),
          },
        );
        const data = (await res.json()) as { error?: string; hint?: string };
        if (!res.ok) {
          setReplyError(data.hint ?? data.error ?? res.statusText);
          setOptimisticMessages((prev) =>
            prev.map((m) =>
              m.id === optimistic.id ? { ...m, status: "failed" } : m,
            ),
          );
          return false;
        }
        if (opts?.clearReplyText) setReplyText("");
        setOptimisticMessages((prev) =>
          prev.map((m) =>
            m.id === optimistic.id ? { ...m, status: "sent" } : m,
          ),
        );
        stream.start(selectedId, {
          seedEventIds: [
            ...(bundleRef.current?.events ?? []).map((e) => e.id),
            ...streamMessages.map((m) => m.id),
          ],
        });
        // Belt-and-suspenders polling loop. The SSE stream usually delivers
        // the next-turn events on its own, but on dev/load environments we
        // sometimes drop them. Polling ensures the user always sees the
        // agent's reply within a few seconds of it landing in the bundle,
        // even if the stream's onEvents dispatch missed it. Mirrors the
        // production page's `guidancePoll` behavior.
        const pollExceptionId = selectedId;
        const myRun = ++postReplyPollRunIdRef.current;
        void (async () => {
          let changed = false;
          let latestSnap = buildPollSnapshot(bundleRef.current);
          let lastChangeAt = 0;
          await sleep(POST_REPLY_DELAY_MS);
          const deadline = Date.now() + POLL_MAX_MS;
          while (Date.now() < deadline) {
            if (postReplyPollRunIdRef.current !== myRun) return;
            if (selectedIdRef.current !== pollExceptionId) return;
            const fresh = await loadDetail(pollExceptionId);
            if (postReplyPollRunIdRef.current !== myRun) return;
            if (fresh && pollSnapshotChanged(latestSnap, fresh)) {
              changed = true;
              lastChangeAt = Date.now();
              latestSnap = buildPollSnapshot(fresh);
            } else if (
              changed &&
              lastChangeAt > 0 &&
              Date.now() - lastChangeAt > POLL_IDLE_STOP_MS
            ) {
              break;
            }
            await sleep(POLL_INTERVAL_MS);
          }
        })();
        return true;
      } catch (e) {
        setReplyError(e instanceof Error ? e.message : "reply_failed");
        setOptimisticMessages((prev) =>
          prev.map((m) =>
            m.id === optimistic.id ? { ...m, status: "failed" } : m,
          ),
        );
        return false;
      } finally {
        setReplyBusy(false);
      }
    },
    [selectedId, replyBusy, stream, streamMessages, loadDetail, setReplyText],
  );

  const submitReply = useCallback(async () => {
    await sendReplyMessage(replyText, { clearReplyText: true });
  }, [replyText, sendReplyMessage]);

  /** Resend the most recent failed bubble (per-bubble retry button). */
  const retryOptimistic = useCallback(
    async (id: string) => {
      const target = optimisticMessages.find((m) => m.id === id);
      if (!target) return;
      setOptimisticMessages((prev) => prev.filter((m) => m.id !== id));
      await sendReplyMessage(target.content, { clearReplyText: false });
    },
    [optimisticMessages, sendReplyMessage],
  );

  /** Suggested-reply button → send the chosen option as the user message. */
  const selectChoice = useCallback(
    (value: string) => {
      void sendReplyMessage(value, { clearReplyText: false });
    },
    [sendReplyMessage],
  );

  /**
   * Resume the automation run that owns this exception (Kognitos
   * `ContinueRun`). Only meaningful when the run is paused or
   * `awaiting_guidance`; the API will reject otherwise. We surface the
   * server's error hint inline so the operator can tell why it didn't
   * apply.
   */
  const continueRunForException = useCallback(async () => {
    if (!selectedId || runBusy) return;
    setRunBusy(true);
    setRunError(null);
    try {
      const res = await fetch(
        `/api/kognitos/exceptions/${encodeURIComponent(selectedId)}/continue-run`,
        { method: "POST" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        hint?: string;
      };
      if (!res.ok) {
        setRunError(data.hint ?? data.error ?? res.statusText);
        return;
      }
      // Re-arm the stream + reload bundle so the resumed run's new events
      // appear in the chat.
      stream.start(selectedId, {
        seedEventIds: (bundleRef.current?.events ?? []).map((e) => e.id),
      });
      setTimeout(() => {
        if (selectedIdRef.current === selectedId) void loadDetail(selectedId);
      }, 1500);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "continue_failed");
    } finally {
      setRunBusy(false);
    }
  }, [selectedId, runBusy, stream, loadDetail]);

  /**
   * One-tap conversational shortcut. Sends a natural-language instruction
   * to the agent ("please mark this as resolved" / "please archive…") via
   * the existing `/reply` route — there's no native exception-state
   * mutation API. The server-side agent is the one that actually flips
   * `state` to `RESOLVED` or `ARCHIVED`; we simply ask it to. Returns
   * once the POST completes (success/failure shows up in the chat as a
   * normal user bubble + agent response).
   */
  const requestStateChange = useCallback(
    async (kind: "resolved" | "archived") => {
      if (!selectedId || replyBusy) return;
      // Track which action is in flight, scoped to this exception.
      setPendingAction((prev) => ({ ...prev, [selectedId]: kind }));
      const message =
        kind === "resolved"
          ? "Please mark this exception as resolved."
          : "Please archive this exception.";
      try {
        await sendReplyMessage(message, { clearReplyText: false });
      } finally {
        setPendingAction((prev) => {
          if (prev[selectedId] !== kind) return prev;
          const copy = { ...prev };
          delete copy[selectedId];
          return copy;
        });
      }
    },
    [selectedId, replyBusy, sendReplyMessage],
  );

  /**
   * Stop the in-flight stream and best-effort cancel agent generation
   * server-side. The UI immediately reflects "stopped" by closing the
   * stream — the POST is fire-and-forget so a slow `/cancel` doesn't
   * leave the button spinning.
   */
  const stopGeneration = useCallback(async () => {
    if (!selectedId || cancelBusyRef.current) return;
    cancelBusyRef.current = true;
    setStopBusy(true);
    stream.stop();
    try {
      await fetch(
        `/api/kognitos/exceptions/${encodeURIComponent(selectedId)}/cancel`,
        { method: "POST" },
      );
    } catch {
      /* best-effort; UI already reflects stopped state */
    } finally {
      cancelBusyRef.current = false;
      setStopBusy(false);
      // Pull a fresh snapshot so the agent's last partial state is captured.
      if (selectedIdRef.current === selectedId) void loadDetail(selectedId);
    }
  }, [selectedId, stream, loadDetail]);

  /**
   * Identity of the *latest* `related-outputs` widget. Only that one is
   * rendered with editable inputs + a Send button — older payloads stay
   * read-only so users can't accidentally overwrite stale data.
   */
  const latestRelatedOutputsKey = useMemo<string | null>(() => {
    let key: string | null = null;
    for (const m of messages) {
      if (m.kind !== "text") continue;
      m.widgets.forEach((w, i) => {
        if (w.kind === "related-outputs") key = `${m.id}#${i}`;
      });
    }
    return key;
  }, [messages]);

  /**
   * Compact-viewport state. Below ~900px the three-column grid stops fitting;
   * we flip to a "list OR detail" toggle keyed off `selectedId`. The user
   * can use the back arrow in the detail topbar to return to the list.
   */
  const [isCompact, setIsCompact] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 900px)");
    const onChange = (e: MediaQueryListEvent | MediaQueryList) =>
      setIsCompact(e.matches);
    onChange(mql);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  /**
   * Resizable divider between the list (left) and the detail/chat (right)
   * columns. The list column has a state-driven pixel width; the detail
   * column flexes (`1fr`). Width is clamped to keep both panels usable
   * (`LIST_MIN`/`LIST_MAX_FALLBACK`) and to always leave at least
   * `DETAIL_MIN` px for the chat. Persisted to `localStorage` so the
   * operator's preferred split survives reloads. The divider itself is
   * a single `6 px` grid track between the two columns; a hidden
   * `<div role="separator">` surfaces it for keyboard + assistive use.
   */
  const LIST_MIN = 240;
  const LIST_MAX_FALLBACK = 720;
  const LIST_DEFAULT = 320;
  const DETAIL_MIN = 480;
  const DIVIDER_TRACK_PX = 6;
  const LIST_LS_KEY = "ehv2:listWidth";

  const [listWidth, setListWidth] = useState<number>(LIST_DEFAULT);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ pointerId: number } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(LIST_LS_KEY);
    if (!raw) return;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= LIST_MIN) setListWidth(n);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LIST_LS_KEY, String(listWidth));
  }, [listWidth]);

  const computeMaxListWidth = useCallback(() => {
    const containerW =
      containerRef.current?.clientWidth ??
      (typeof window !== "undefined" ? window.innerWidth : 1280);
    return Math.max(
      LIST_MIN + 1,
      Math.min(LIST_MAX_FALLBACK, containerW - DETAIL_MIN - DIVIDER_TRACK_PX),
    );
  }, []);

  // Re-clamp the list width whenever the viewport shrinks so the detail
  // column never collapses below `DETAIL_MIN`.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      const max = computeMaxListWidth();
      setListWidth((w) => Math.min(Math.max(LIST_MIN, w), max));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [computeMaxListWidth]);

  const onDividerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isCompact) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStateRef.current = { pointerId: e.pointerId };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [isCompact],
  );

  const onDividerPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStateRef.current) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const max = computeMaxListWidth();
      const next = Math.round(
        Math.min(max, Math.max(LIST_MIN, e.clientX - rect.left)),
      );
      setListWidth(next);
    },
    [computeMaxListWidth],
  );

  const onDividerPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStateRef.current) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // pointer capture may already be released on cancel
      }
      dragStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    },
    [],
  );

  const onDividerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const max = computeMaxListWidth();
      const step = e.shiftKey ? 48 : 16;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setListWidth((w) => Math.max(LIST_MIN, w - step));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setListWidth((w) => Math.min(max, w + step));
      } else if (e.key === "Home") {
        e.preventDefault();
        setListWidth(LIST_MIN);
      } else if (e.key === "End") {
        e.preventDefault();
        setListWidth(max);
      }
    },
    [computeMaxListWidth],
  );

  /**
   * Page-level keyboard navigation. j / ArrowDown moves to the next row,
   * k / ArrowUp moves to the previous, Escape clears selection. We skip
   * shortcuts when the user is typing inside an editable element so the
   * compose textarea, search input, and widget inputs aren't hijacked.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        return;
      }
      if (filteredItems.length === 0) return;
      const dir = e.key === "j" || e.key === "ArrowDown"
        ? 1
        : e.key === "k" || e.key === "ArrowUp"
          ? -1
          : 0;
      if (dir === 0) return;
      e.preventDefault();
      const curIdx = selectedId
        ? filteredItems.findIndex((r) => r.exceptionId === selectedId)
        : -1;
      const nextIdx = curIdx === -1
        ? dir > 0
          ? 0
          : filteredItems.length - 1
        : Math.min(
            filteredItems.length - 1,
            Math.max(0, curIdx + dir),
          );
      const nextRow = filteredItems[nextIdx];
      if (nextRow) setSelectedId(nextRow.exceptionId);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filteredItems, selectedId]);

  if (!user) return null;

  const selectedRow = items.find((r) => r.exceptionId === selectedId) ?? null;
  const showDetailOnCompact = isCompact && Boolean(selectedId);
  const showListOnCompact = isCompact && !selectedId;

  return (
    // The page lives inside the dashboard layout (`app/(dashboard)/layout.tsx`)
    // which provides the global Sidebar, Topbar, and ChatPanel and wraps
    // children in `<main className="p-4 lg:p-6">`. We claim back that
    // padding with negative margins so the v2 list/detail grid fills the
    // remaining viewport edge-to-edge (the inner panels manage their own
    // padding). Height is the viewport minus the dashboard's ~56 px topbar.
    <div
      ref={containerRef}
      className="ehv2-root -m-4 lg:-m-6"
      style={{
        background: "#ffffff",
        display: "grid",
        // Compact viewports collapse to a single content column.
        // Otherwise: list width is operator-controlled (drag divider),
        // followed by a 6 px divider track and a flex detail column.
        gridTemplateColumns: isCompact
          ? "1fr"
          : `${listWidth}px ${DIVIDER_TRACK_PX}px 1fr`,
        height: "calc(100vh - 56px)",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
        {/* Column 2 — List */}
        <div
          className="min-h-0 min-w-0 overflow-hidden"
          style={{
            display: !isCompact || showListOnCompact ? "flex" : "none",
            flexDirection: "column",
          }}
        ><ListPanel
          items={filteredItems}
          totalItems={items.length}
          stateFilter={stateFilter}
          onChangeFilter={setStateFilter}
          searchText={searchText}
          onSearchChange={setSearchText}
          selectedId={selectedId}
          onSelect={setSelectedId}
          listLoading={listLoading}
          listError={listError}
          onRefresh={() => {
            // Refresh resets pagination — we always reload the first page.
            setPageStack([null]);
            setNextPageToken(null);
            void loadList(stateFilter);
            void (async () => {
              const [p, r] = await Promise.all([
                fetchCount("pending"),
                fetchCount("resolved"),
              ]);
              setPendingCount(p);
              setResolvedCount(r);
            })();
          }}
          pendingCount={pendingCount}
          resolvedCount={resolvedCount}
          canGoPrev={pageStack.length > 1}
          canGoNext={Boolean(nextPageToken)}
          onPrevPage={() => void goPrevPage()}
          onNextPage={() => void goNextPage()}
          pageIndex={pageStack.length}
        />
        </div>

        {/*
          Resizable divider — sits as the middle 6 px grid track between the
          list and detail columns. Hidden in compact mode (single-column).
          Pointer-capture-based drag with keyboard fallback (←/→ to step,
          Shift+←/→ for larger jumps, Home/End to snap, double-click to
          reset). Persisted via {@link LIST_LS_KEY}.
        */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={listWidth}
          aria-valuemin={LIST_MIN}
          aria-valuemax={Math.round(computeMaxListWidth())}
          aria-label="Resize exception list panel"
          tabIndex={0}
          title="Drag to resize. Double-click to reset."
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={onDividerPointerUp}
          onPointerCancel={onDividerPointerUp}
          onKeyDown={onDividerKeyDown}
          onDoubleClick={() => setListWidth(LIST_DEFAULT)}
          className="group relative cursor-col-resize select-none bg-zinc-200 transition-colors hover:bg-zinc-300 focus:bg-zinc-300 focus:outline-none focus-visible:bg-blue-300"
          style={{
            display: isCompact ? "none" : "block",
            touchAction: "none",
          }}
        >
          {/* Centered grab indicator (3 dots) — only visible on hover/focus */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-[3px] opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
          >
            <span className="block h-[3px] w-[3px] rounded-full bg-zinc-600" />
            <span className="block h-[3px] w-[3px] rounded-full bg-zinc-600" />
            <span className="block h-[3px] w-[3px] rounded-full bg-zinc-600" />
          </div>
        </div>

        {/* Column 3 — Detail */}
        <div
          className="min-h-0 min-w-0 overflow-hidden"
          style={{
            display: !isCompact || showDetailOnCompact ? "flex" : "none",
            flexDirection: "column",
          }}
        ><DetailPanel
          bundle={bundle}
          selectedRow={selectedRow}
          detailLoading={detailLoading}
          detailError={detailError}
          onRetryDetail={() => {
            if (selectedId) void loadDetail(selectedId);
          }}
          allMessages={visibleMessages}
          historyOpen={historyOpen}
          onToggleHistory={toggleHistoryOpen}
          isAgentWorking={isAgentWorking}
          streamStatus={stream.status}
          replyText={replyText}
          onChangeReplyText={setReplyText}
          onSubmitReply={submitReply}
          replyBusy={replyBusy}
          replyError={replyError}
          stopBusy={stopBusy}
          onStop={() => void stopGeneration()}
          contextOpen={contextOpen}
          onToggleContext={toggleContextOpen}
          activityOpen={activityOpen}
          onToggleActivity={toggleActivityOpen}
          userFullName={user.full_name}
          latestRelatedOutputsKey={latestRelatedOutputsKey}
          runId={bundle?.exception?.runId ?? null}
          onOpenDocumentViewer={handleOpenAttachment}
          onSendRaw={(content) =>
            sendReplyMessage(content, { clearReplyText: false })
          }
          onSelectChoice={selectChoice}
          onRetryOptimistic={retryOptimistic}
          onRunContinue={() => void continueRunForException()}
          runBusy={runBusy}
          runError={runError}
          onRequestStateChange={(kind) => void requestStateChange(kind)}
          pendingActionKind={
            selectedId ? (pendingAction[selectedId] ?? null) : null
          }
          streamFallbackError={streamFallbackError}
          onReconnectStream={reconnectStream}
          onCloseDetail={() => setSelectedId(null)}
          showBackToList={isCompact}
        />
        </div>

      {/*
        Document viewer dialog — same {@link InvoicePdfHighlightViewer} the
        dashboard runs-analyzed table and the v1 exception page use. Lives at
        the page level so it can be opened from any chat document-preview
        widget without nested dialog state. Mirrors v1's mount in
        `app/(dashboard)/exception-handling/page.tsx`.
      */}
      <Dialog
        open={documentViewer != null}
        onOpenChange={(open) => {
          if (!open) setDocumentViewer(null);
        }}
      >
        <DialogContent
          centerFlex
          showCloseButton
          className="flex h-[min(82.8vh,828px)] w-[min(88.2vw,82.8rem)] max-w-[min(88.2vw,82.8rem)] flex-col gap-0 overflow-hidden border border-white/[0.08] bg-zinc-900 p-0 text-zinc-100 shadow-xl shadow-black/20 sm:max-w-[min(88.2vw,82.8rem)] [&_[data-slot=dialog-close]]:text-zinc-400 [&_[data-slot=dialog-close]]:hover:text-zinc-100"
        >
          <DialogHeader className="shrink-0 border-b border-white/[0.07] bg-zinc-900 px-4 py-2 text-left">
            <DialogTitle className="text-base font-medium text-zinc-50">
              {documentViewer?.label ?? "Document Processing"}
            </DialogTitle>
          </DialogHeader>
          {documentViewer ? (
            // `key` resets every internal ref (zoom cap, focused field,
            // page number, panel state) when the operator opens a
            // different run — cheap defense-in-depth on top of the
            // viewer's own runId-keyed effects.
            <InvoicePdfHighlightViewer
              key={documentViewer.runId}
              pdfUrl={documentViewer.pdfUrl}
              runId={documentViewer.runId}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/*
        Image preview dialog — in-app modal for non-PDF attachments
        (PNG/JPG/GIF/WebP/SVG). Replaces the OS-level browser popup the
        v2 chat used to fall through to for images, so the user keeps
        the dashboard's modal context. Mirrors the PDF dialog's chrome
        (dark surround, white document) so attachment-type doesn't
        introduce a chrome jump.
      */}
      <ChatImagePreviewDialog
        data={imagePreview}
        onClose={() => setImagePreview(null)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// List panel
// ─────────────────────────────────────────────────────────────────

type ListPanelProps = {
  items: ExceptionSummaryDto[];
  totalItems: number;
  stateFilter: StateFilterParam;
  onChangeFilter: (f: StateFilterParam) => void;
  searchText: string;
  onSearchChange: (s: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  listLoading: boolean;
  listError: string | null;
  onRefresh: () => void;
  pendingCount: number | null;
  resolvedCount: number | null;
  /** True when there's a previous page in the stack. */
  canGoPrev: boolean;
  /** True when the server returned a non-null `nextPageToken`. */
  canGoNext: boolean;
  onPrevPage: () => void;
  onNextPage: () => void;
  /** 1-based page index (just for display). */
  pageIndex: number;
};

function ListPanel({
  items,
  totalItems,
  stateFilter,
  onChangeFilter,
  searchText,
  onSearchChange,
  selectedId,
  onSelect,
  listLoading,
  listError,
  onRefresh,
  pendingCount,
  resolvedCount,
  canGoPrev,
  canGoNext,
  onPrevPage,
  onNextPage,
  pageIndex,
}: ListPanelProps) {
  // We render every loaded item; pagination is driven by the API token
  // (no client-side slice needed beyond what the server returned).
  const visibleSlice = items;
  const totalLabel =
    totalItems === 0
      ? "0 of 0"
      : `1\u2013${visibleSlice.length} on page ${pageIndex}`;

  return (
    <div
      className="flex min-h-0 min-w-0 flex-col overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.80)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        borderRight: "0.5px solid rgba(0,0,0,0.08)",
      }}
    >
      <div
        className="flex items-start justify-between gap-2"
        style={{ padding: "20px 18px 0" }}
      >
        <div className="min-w-0">
          <h1
            style={{
              fontSize: 21,
              fontWeight: 600,
              letterSpacing: "-0.4px",
              color: "#1d1d1f",
              margin: 0,
            }}
          >
            Exceptions
          </h1>
          <p
            style={{
              fontSize: 12,
              color: "#aeaeb2",
              marginTop: 2,
            }}
          >
            Triage and resolve automation issues
          </p>
        </div>
        <button
          type="button"
          aria-label="Refresh exception list"
          onClick={onRefresh}
          disabled={listLoading}
          title="Refresh"
          className="flex shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "transparent",
            border: "0.5px solid rgba(0,0,0,0.10)",
            color: "#6e6e73",
            cursor: listLoading ? "wait" : "pointer",
            opacity: listLoading ? 0.6 : 1,
            marginTop: 2,
          }}
        >
          <RefreshCw
            size={13}
            strokeWidth={1.75}
            className={listLoading ? "animate-spin" : undefined}
          />
        </button>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Filter exceptions"
        className="flex items-end gap-4"
        style={{
          padding: "14px 18px 0",
          borderBottom: "0.5px solid rgba(0,0,0,0.08)",
        }}
      >
        {TABS.map((t) => {
          const active = stateFilter === t.value;
          const countBg = COUNT_BG[t.value];
          const count =
            t.value === "pending"
              ? pendingCount
              : t.value === "resolved"
                ? resolvedCount
                : null;
          return (
            <button
              key={t.value}
              role="tab"
              aria-selected={active}
              onClick={() => onChangeFilter(t.value)}
              className="inline-flex items-center gap-1.5 pb-2 outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/40"
              style={{
                fontSize: 12,
                fontWeight: active ? 500 : 400,
                color: active ? "#0071e3" : "#6e6e73",
                borderBottom: active
                  ? "2px solid #0071e3"
                  : "2px solid transparent",
                marginBottom: -1,
                background: "none",
                padding: "0 0 8px 0",
              }}
            >
              {t.label}
              {countBg && count !== null && count > 0 ? (
                <span
                  style={{
                    background: countBg,
                    color: "white",
                    fontSize: 10,
                    padding: "1px 6px",
                    borderRadius: 20,
                    lineHeight: 1.2,
                  }}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div style={{ margin: "10px 18px" }} className="relative">
        <Search
          aria-hidden
          size={13}
          strokeWidth={1.75}
          style={{
            position: "absolute",
            left: 10,
            top: "50%",
            transform: "translateY(-50%)",
            color: "#aeaeb2",
            pointerEvents: "none",
          }}
        />
        <input
          type="text"
          placeholder="Search exceptions"
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{
            width: "100%",
            background: "rgba(118,118,128,0.11)",
            border: "none",
            borderRadius: 10,
            padding: "7px 10px 7px 30px",
            fontSize: 12.5,
            color: "#1d1d1f",
            outline: "none",
          }}
        />
      </div>

      {/* Rows */}
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "0 12px" }}>
        {listError ? (
          <InlineErrorBanner
            message={listError}
            onRetry={onRefresh}
            label="Couldn't load exceptions"
          />
        ) : null}
        {listLoading && items.length === 0 ? (
          <div
            className="flex items-center gap-2"
            style={{ padding: "12px", color: "#aeaeb2", fontSize: 12 }}
          >
            <Loader2 className="size-3.5 animate-spin" />
            Loading…
          </div>
        ) : null}
        {!listLoading && !listError && items.length === 0 ? (
          <p
            style={{
              padding: "12px",
              color: "#aeaeb2",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            {totalItems === 0
              ? "No exceptions for this filter."
              : "No exceptions match your search."}
          </p>
        ) : null}
        {visibleSlice.map((row, i) => {
          const sev = severityFor(row);
          const selected = row.exceptionId === selectedId;
          return (
            <button
              key={row.exceptionId}
              type="button"
              data-row-id={row.exceptionId}
              onClick={() => onSelect(row.exceptionId)}
              className={cn(
                "ehv2-row-in relative w-full text-left transition-colors outline-none",
                "focus-visible:ring-2 focus-visible:ring-[#0071e3]/30",
              )}
              style={{
                padding: "11px 12px",
                paddingRight: 56,
                borderRadius: 10,
                marginBottom: 2,
                background: selected
                  ? "rgba(0,113,227,0.09)"
                  : "transparent",
                cursor: "pointer",
                animationDelay: `${0.04 * (i + 1)}s`,
              }}
              onMouseEnter={(e) => {
                if (selected) return;
                e.currentTarget.style.background = "rgba(0,0,0,0.04)";
              }}
              onMouseLeave={(e) => {
                if (selected) return;
                e.currentTarget.style.background = "transparent";
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  aria-hidden
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 9999,
                    background: SEVERITY[sev],
                    flexShrink: 0,
                  }}
                />
                <span
                  className="truncate"
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#1d1d1f",
                    lineHeight: 1.3,
                  }}
                  title={row.title}
                >
                  {row.title}
                </span>
              </div>
              <p
                className="truncate"
                style={{
                  fontSize: 11.5,
                  color: "#aeaeb2",
                  marginTop: 2.5,
                  paddingLeft: 15,
                }}
              >
                {row.groupLabel}
                {row.automationDisplayName
                  ? ` · ${row.automationDisplayName}`
                  : ""}
              </p>
              <span
                style={{
                  position: "absolute",
                  right: 12,
                  top: 12,
                  fontSize: 11,
                  color: "#aeaeb2",
                  whiteSpace: "nowrap",
                }}
              >
                {shortAge(row.createTime)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div
        className="flex shrink-0 items-center justify-between"
        style={{
          padding: "9px 18px",
          borderTop: "0.5px solid rgba(0,0,0,0.08)",
          fontSize: 11,
          color: "#aeaeb2",
        }}
      >
        <span>{totalLabel}</span>
        <Pagination
          canGoPrev={canGoPrev}
          canGoNext={canGoNext}
          onPrev={onPrevPage}
          onNext={onNextPage}
          loading={listLoading}
          pageIndex={pageIndex}
        />
      </div>
    </div>
  );
}

function Pagination({
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
  loading,
  pageIndex,
}: {
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  loading: boolean;
  pageIndex: number;
}) {
  const baseBtn: React.CSSProperties = {
    width: 24,
    height: 24,
    border: "0.5px solid rgba(0,0,0,0.08)",
    background: "white",
    color: "#6e6e73",
    fontSize: 12,
    lineHeight: 1,
  };
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="Previous page"
        onClick={onPrev}
        disabled={!canGoPrev || loading}
        className="flex items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/40"
        style={{
          ...baseBtn,
          opacity: !canGoPrev || loading ? 0.45 : 1,
          cursor: !canGoPrev || loading ? "not-allowed" : "pointer",
        }}
      >
        ‹
      </button>
      <span
        aria-current="page"
        className="flex items-center justify-center rounded-md"
        style={{
          minWidth: 24,
          height: 24,
          fontSize: 11,
          background: "#0071e3",
          color: "white",
          padding: "0 7px",
          fontWeight: 500,
        }}
      >
        {pageIndex}
      </span>
      <button
        type="button"
        aria-label="Next page"
        onClick={onNext}
        disabled={!canGoNext || loading}
        className="flex items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/40"
        style={{
          ...baseBtn,
          opacity: !canGoNext || loading ? 0.45 : 1,
          cursor: !canGoNext || loading ? "not-allowed" : "pointer",
        }}
      >
        ›
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Detail panel
// ─────────────────────────────────────────────────────────────────

type DetailPanelProps = {
  bundle: ExceptionDetailBundleDto | null;
  selectedRow: ExceptionSummaryDto | null;
  detailLoading: boolean;
  detailError: string | null;
  onRetryDetail: () => void;
  /** Full transcript (text + thinking + tool-call + system-error). DetailPanel decides what to show. */
  allMessages: VisibleMessage[];
  /** Whether the user has expanded the "earlier messages" history. */
  historyOpen: boolean;
  onToggleHistory: () => void;
  isAgentWorking: boolean;
  streamStatus: ExceptionStreamStatus;
  replyText: string;
  onChangeReplyText: (s: string) => void;
  onSubmitReply: () => void;
  replyBusy: boolean;
  replyError: string | null;
  stopBusy: boolean;
  onStop: () => void;
  contextOpen: boolean;
  onToggleContext: () => void;
  activityOpen: boolean;
  onToggleActivity: () => void;
  userFullName: string;
  latestRelatedOutputsKey: string | null;
  /**
   * Exception's `runId` (when known). Required to open the highlight viewer
   * dialog because field overlays/confidences come from
   * `/api/kognitos/runs/{runId}/payload`. Passed down to widget renderers.
   */
  runId: string | null;
  /**
   * Open the page-level highlight-viewer dialog for a chat attachment.
   * Mirrors v1's prop drilling pattern.
   */
  onOpenDocumentViewer: (args: ChatDocumentViewerOpen) => void;
  onSendRaw: (content: string) => Promise<boolean>;
  onSelectChoice: (value: string) => void;
  onRetryOptimistic: (id: string) => void;
  /** Resume the run that owns the current exception (Kognitos `ContinueRun`). */
  onRunContinue: () => void;
  runBusy: boolean;
  runError: string | null;
  /** Last error that pushed the stream into polling-fallback mode. */
  streamFallbackError: string | null;
  /** User-driven reconnect from the fallback banner. */
  onReconnectStream: () => void;
  /** Conversational shortcut for state changes. */
  onRequestStateChange: (kind: "resolved" | "archived") => void;
  /** Which conversational action is in flight, if any. */
  pendingActionKind: "resolved" | "archived" | null;
  /** Clear the current selection (used by the topbar overflow menu). */
  onCloseDetail: () => void;
  /** When true, render a "back to list" arrow in the topbar (compact viewports). */
  showBackToList: boolean;
};

function DetailPanel({
  bundle,
  selectedRow,
  detailLoading,
  detailError,
  onRetryDetail,
  allMessages,
  historyOpen,
  onToggleHistory,
  isAgentWorking,
  streamStatus,
  replyText,
  onChangeReplyText,
  onSubmitReply,
  replyBusy,
  replyError,
  stopBusy,
  onStop,
  contextOpen,
  onToggleContext,
  activityOpen,
  onToggleActivity,
  userFullName,
  latestRelatedOutputsKey,
  runId,
  onOpenDocumentViewer,
  onSendRaw,
  onSelectChoice,
  onRetryOptimistic,
  onRunContinue,
  runBusy,
  runError,
  onRequestStateChange,
  pendingActionKind,
  streamFallbackError,
  onReconnectStream,
  onCloseDetail,
  showBackToList,
}: DetailPanelProps) {
  const ex = bundle?.exception ?? null;
  const titleText = ex?.title ?? selectedRow?.title ?? "Exception detail";
  const subtitleAge = shortAge(ex?.createTime ?? selectedRow?.createTime ?? null);
  const automationName =
    ex?.automationDisplayName ?? selectedRow?.automationDisplayName ?? null;
  const chip = statusChip(ex?.state ?? selectedRow?.state ?? "PENDING");

  // Visible slice — collapse anything older than the last 6 messages
  // unless the user has expanded the history toggle.
  const VISIBLE_TAIL = 6;
  const earlierCount = Math.max(0, allMessages.length - VISIBLE_TAIL);
  const visibleMessages = historyOpen
    ? allMessages
    : allMessages.slice(-VISIBLE_TAIL);

  return (
    <div
      className="flex min-h-0 min-w-0 flex-col overflow-hidden"
      style={{ background: "#f5f5f7" }}
    >
      {/* Topbar */}
      <div
        className="shrink-0"
        style={{
          background: "rgba(255,255,255,0.82)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          borderBottom: "0.5px solid rgba(0,0,0,0.08)",
          padding: "17px 22px 13px",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            {showBackToList ? (
              <button
                type="button"
                onClick={onCloseDetail}
                aria-label="Back to list"
                className="flex shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
                style={{
                  width: 28,
                  height: 28,
                  border: "0.5px solid rgba(0,0,0,0.12)",
                  background: "white",
                  borderRadius: 7,
                  color: "#1d1d1f",
                  marginTop: 1,
                }}
                title="Back to exception list"
              >
                <ChevronRight
                  size={14}
                  strokeWidth={1.75}
                  fill="none"
                  style={{ transform: "rotate(180deg)" }}
                />
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
            <h2
              className="truncate"
              style={{
                fontSize: 17,
                fontWeight: 600,
                letterSpacing: "-0.3px",
                color: "#1d1d1f",
                margin: 0,
              }}
              title={titleText}
            >
              {titleText}
            </h2>
            <div
              className="flex flex-wrap items-center gap-2"
              style={{ marginTop: 6 }}
            >
              <span
                className="inline-flex items-center gap-1.5"
                style={{
                  background: chip.bg,
                  color: chip.fg,
                  borderRadius: 20,
                  padding: "3px 10px",
                  fontSize: 11,
                  fontWeight: 500,
                  lineHeight: 1.4,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 9999,
                    background: chip.dot,
                  }}
                />
                {chip.label}
              </span>
              <span style={{ fontSize: 12, color: "#aeaeb2" }}>
                {subtitleAge}
                {automationName ? ` · ${automationName}` : ""}
              </span>
            </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {(() => {
              const runStatus = runStatusFromBundle(bundle);
              const continueable = isRunContinueable(runStatus);
              const disabled = runBusy || !bundle || !continueable;
              const tooltip = !bundle
                ? "Select an exception first"
                : !continueable
                  ? `Run is ${runStatus} — only awaiting-guidance runs can be resumed`
                  : "Resume the automation run for this exception";
              return (
                <button
                  type="button"
                  onClick={onRunContinue}
                  disabled={disabled}
                  title={tooltip}
                  className="inline-flex items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
                  style={{
                    border: "0.5px solid rgba(0,0,0,0.12)",
                    background: "white",
                    borderRadius: 7,
                    padding: "5px 14px",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#1d1d1f",
                    opacity: disabled ? 0.55 : 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                >
                  {runBusy ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Play size={12} strokeWidth={1.75} fill="none" />
                  )}
                  {runBusy ? "Resuming…" : "Run"}
                </button>
              );
            })()}
            <DetailOverflowMenu
              bundle={bundle}
              onCloseDetail={onCloseDetail}
              onReconnectStream={onReconnectStream}
              streamFallbackActive={Boolean(streamFallbackError)}
            />
          </div>
        </div>
      </div>

      {/* Body — flex column; only the chat card scrolls internally */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{ padding: "14px 22px", gap: 10 }}
      >
        {detailError ? (
          <InlineErrorBanner
            message={detailError}
            onRetry={onRetryDetail}
            label="Couldn't load this exception"
          />
        ) : null}
        {runError ? (
          <InlineErrorBanner
            message={runError}
            onRetry={onRunContinue}
            label="Couldn't resume the run"
          />
        ) : null}
        {streamFallbackError ? (
          <InlineWarningBanner
            label="Live updates unavailable"
            message="Polling for new messages every 8 seconds. Reconnect to resume real-time updates."
            actionLabel="Reconnect"
            onAction={onReconnectStream}
          />
        ) : null}

        {/* Card 1 — What happened */}
        <Card1WhatHappened
          text={
            detailLoading && !bundle
              ? "Loading…"
              : whatHappenedText(bundle) || "No description available."
          }
          delay="0.06s"
        />

        {/* Card 2 — Recommended action */}
        <Card2RecommendedAction
          text={
            bundle
              ? recommendedActionText(bundle)
              : "Select an exception to see the recommended action."
          }
          delay="0.12s"
        />

        {/* Card 3 — Resolution agent (fills remaining height) */}
        <Card3ResolutionAgent
          messages={visibleMessages}
          earlierCount={earlierCount}
          historyOpen={historyOpen}
          onToggleHistory={onToggleHistory}
          paused={ex?.state === "PENDING"}
          isAgentWorking={isAgentWorking}
          streamStatus={streamStatus}
          replyText={replyText}
          onChangeReplyText={onChangeReplyText}
          onSubmitReply={onSubmitReply}
          replyBusy={replyBusy}
          replyError={replyError}
          stopBusy={stopBusy}
          onStop={onStop}
          updatedAt={shortAge(ex?.createTime ?? null)}
          delay="0.18s"
          latestRelatedOutputsKey={latestRelatedOutputsKey}
          runId={runId}
          onOpenDocumentViewer={onOpenDocumentViewer}
          onSendRaw={onSendRaw}
          onSelectChoice={onSelectChoice}
          onRetryOptimistic={onRetryOptimistic}
        />
      </div>

      {/* Collapsibles */}
      <div className="shrink-0">
        <Collapsible
          label="Context"
          open={contextOpen}
          onToggle={onToggleContext}
        >
          <KeyValueList
            rows={[
              {
                k: "Automation",
                v: ex?.automationDisplayName ?? selectedRow?.automationDisplayName ?? "—",
              },
              { k: "Run ID", v: ex?.runId ?? "—", mono: true },
              { k: "Step", v: ex?.locationDisplay ?? "—" },
              {
                k: "Group",
                v: ex?.groupLabel ?? selectedRow?.groupLabel ?? "—",
              },
            ]}
          />
        </Collapsible>
        <Collapsible
          label="Activity"
          open={activityOpen}
          onToggle={onToggleActivity}
        >
          <KeyValueList
            rows={[
              {
                k: "Created",
                v: `${shortAge(ex?.createTime ?? null)}${
                  automationName ? ` by ${automationName}` : ""
                }`,
              },
              { k: "Last updated", v: shortAge(ex?.createTime ?? null) },
              { k: "Assigned to", v: userFullName },
            ]}
          />
        </Collapsible>
      </div>

      {/* Action bar */}
      {(() => {
        const exState = ex?.state ?? selectedRow?.state ?? null;
        const isTerminal = exState === "RESOLVED" || exState === "ARCHIVED";
        const resolveBusy = pendingActionKind === "resolved";
        const archiveBusy = pendingActionKind === "archived";
        const disabled = !bundle || replyBusy || isTerminal;
        const helper = isTerminal
          ? exState === "RESOLVED"
            ? "Already resolved"
            : "Already archived"
          : "Sends a request to the agent — it decides when to flip the state.";
        return (
          <div
            className="flex shrink-0 flex-col"
            style={{ padding: "0 22px 16px", gap: 6 }}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onRequestStateChange("resolved")}
                disabled={disabled || resolveBusy}
                title={helper}
                className="outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/40"
                style={{
                  flex: 1,
                  background: "#0071e3",
                  color: "white",
                  border: "none",
                  borderRadius: 10,
                  padding: "9px 0",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor:
                    disabled || resolveBusy ? "not-allowed" : "pointer",
                  opacity: disabled || resolveBusy ? 0.55 : 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                {resolveBusy ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : null}
                {resolveBusy
                  ? "Asking agent…"
                  : exState === "RESOLVED"
                    ? "Resolved"
                    : "Mark as resolved"}
              </button>
              <button
                type="button"
                onClick={() => onRequestStateChange("archived")}
                disabled={disabled || archiveBusy}
                title={helper}
                className="inline-flex items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
                style={{
                  background: "white",
                  border: "0.5px solid rgba(0,0,0,0.12)",
                  borderRadius: 10,
                  padding: "9px 18px",
                  fontSize: 13,
                  color: "#6e6e73",
                  cursor:
                    disabled || archiveBusy ? "not-allowed" : "pointer",
                  opacity: disabled || archiveBusy ? 0.55 : 1,
                }}
              >
                {archiveBusy ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <ArchiveIcon size={13} strokeWidth={1.75} fill="none" />
                )}
                {archiveBusy
                  ? "Asking agent…"
                  : exState === "ARCHIVED"
                    ? "Archived"
                    : "Archive"}
              </button>
            </div>
            <p
              style={{
                fontSize: 10.5,
                color: "#aeaeb2",
                margin: 0,
                lineHeight: 1.4,
              }}
            >
              {helper}
            </p>
          </div>
        );
      })()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Detail panel — cards
// ─────────────────────────────────────────────────────────────────

/**
 * Topbar overflow menu (the "..." next to Run). Hosts low-frequency
 * actions: jump to the production page, copy the exception/run id to the
 * clipboard, force a stream reconnect (when in fallback), open the run in
 * Kognitos, and clear the current selection.
 */
function DetailOverflowMenu({
  bundle,
  onCloseDetail,
  onReconnectStream,
  streamFallbackActive,
}: {
  bundle: ExceptionDetailBundleDto | null;
  onCloseDetail: () => void;
  onReconnectStream: () => void;
  streamFallbackActive: boolean;
}) {
  const ex = bundle?.exception ?? null;
  const runUrl = bundle?.kognitosRunUrl ?? null;

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Ignore clipboard errors — this is best-effort UX.
    }
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="More actions"
          className="flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
          style={{
            width: 28,
            height: 28,
            border: "0.5px solid rgba(0,0,0,0.12)",
            background: "white",
            borderRadius: 7,
            color: "#6e6e73",
          }}
        >
          <MoreHorizontal size={14} strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          disabled={!ex?.exceptionId}
          onSelect={() => ex && void copy(ex.exceptionId)}
        >
          Copy exception ID
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!ex?.runId}
          onSelect={() => ex?.runId && void copy(ex.runId)}
        >
          Copy run ID
        </DropdownMenuItem>
        {runUrl ? (
          <DropdownMenuItem asChild>
            <a href={runUrl} target="_blank" rel="noreferrer">
              Open run in Kognitos
            </a>
          </DropdownMenuItem>
        ) : null}
        {ex?.exceptionId ? (
          <DropdownMenuItem asChild>
            <a
              href={`/exception-handling?exception=${encodeURIComponent(ex.exceptionId)}`}
              rel="noreferrer"
            >
              Open in production page
            </a>
          </DropdownMenuItem>
        ) : null}
        {streamFallbackActive ? (
          <DropdownMenuItem onSelect={onReconnectStream}>
            Reconnect live stream
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCloseDetail}>
          Close detail
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CardLabel({
  icon,
  text,
  color = "#aeaeb2",
}: {
  icon: React.ReactNode;
  text: string;
  color?: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5"
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        color,
        marginBottom: 6,
      }}
    >
      {icon}
      {text}
    </div>
  );
}

function Card1WhatHappened({ text, delay }: { text: string; delay: string }) {
  return (
    <section
      className="ehv2-card-up"
      style={{
        background: "white",
        borderRadius: 13,
        border: "0.5px solid rgba(0,0,0,0.08)",
        padding: "13px 16px",
        animationDelay: delay,
      }}
    >
      <CardLabel
        icon={<Info size={12} strokeWidth={1.75} fill="none" aria-hidden />}
        text="What happened"
      />
      <p
        style={{
          fontSize: 13,
          color: "#6e6e73",
          lineHeight: 1.6,
          margin: 0,
          overflowWrap: "anywhere",
        }}
      >
        {text}
      </p>
    </section>
  );
}

function Card2RecommendedAction({
  text,
  delay,
}: {
  text: string;
  delay: string;
}) {
  return (
    <section
      className="ehv2-card-up"
      style={{
        background: "rgba(52,199,89,0.06)",
        border: "0.5px solid rgba(52,199,89,0.20)",
        borderRadius: 13,
        padding: "13px 16px",
        animationDelay: delay,
      }}
    >
      <CardLabel
        icon={
          <CheckCircle2
            size={12}
            strokeWidth={1.75}
            fill="none"
            aria-hidden
            style={{ color: "#166534" }}
          />
        }
        text="Recommended action"
        color="#166534"
      />
      <p
        style={{
          fontSize: 13,
          color: "#14532d",
          lineHeight: 1.6,
          margin: 0,
          overflowWrap: "anywhere",
        }}
      >
        {text}
      </p>
    </section>
  );
}

type Card3Props = {
  messages: VisibleMessage[];
  earlierCount: number;
  historyOpen: boolean;
  onToggleHistory: () => void;
  paused: boolean;
  isAgentWorking: boolean;
  streamStatus: ExceptionStreamStatus;
  replyText: string;
  onChangeReplyText: (s: string) => void;
  onSubmitReply: () => void;
  replyBusy: boolean;
  replyError: string | null;
  stopBusy: boolean;
  onStop: () => void;
  updatedAt: string;
  delay: string;
  /** Identity of the latest interactive `related-outputs` widget. */
  latestRelatedOutputsKey: string | null;
  /** Exception's `runId` (when known) — see `DetailPanelProps.runId`. */
  runId: string | null;
  /** Open the page-level highlight-viewer dialog for a chat attachment. */
  onOpenDocumentViewer: (args: ChatDocumentViewerOpen) => void;
  /** Send arbitrary content (free text or pre-built XML payload). */
  onSendRaw: (content: string) => Promise<boolean>;
  /** Click a `<choices>` option → dispatched as a user reply. */
  onSelectChoice: (value: string) => void;
  /** Retry a failed optimistic message in place. */
  onRetryOptimistic: (id: string) => void;
};

function Card3ResolutionAgent({
  messages,
  earlierCount,
  historyOpen,
  onToggleHistory,
  paused,
  isAgentWorking,
  streamStatus,
  replyText,
  onChangeReplyText,
  onSubmitReply,
  replyBusy,
  replyError,
  stopBusy,
  onStop,
  updatedAt,
  delay,
  latestRelatedOutputsKey,
  runId,
  onOpenDocumentViewer,
  onSendRaw,
  onSelectChoice,
  onRetryOptimistic,
}: Card3Props) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  /**
   * "Pinned to bottom" — true when the user is at (or within ~24px of)
   * the latest message. We only auto-scroll on new content while pinned;
   * otherwise we hold their position and surface a "Jump to latest" pill.
   * Initialized true so the first paint snaps to the newest message.
   */
  const pinnedRef = useRef(true);
  const [showJumpPill, setShowJumpPill] = useState(false);

  // Auto-grow textarea, capped at 90px.
  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 90)}px`;
  }

  useLayoutEffect(() => {
    if (taRef.current) autoGrow(taRef.current);
  }, [replyText]);

  // Track scroll position to maintain the "pinned" state. We use a 24px
  // tolerance so a couple of new lines don't dislodge the pin.
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const nearBottom = distance < 24;
      pinnedRef.current = nearBottom;
      setShowJumpPill((cur) => (cur === !nearBottom ? cur : !nearBottom));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Reset the pin and snap to bottom whenever the conversation switches.
  // We key on the first/last message id so we don't reset on every render.
  // Notice we don't call `setShowJumpPill` directly — the scroll handler
  // we attach below will fire on the synthetic scroll event we dispatch,
  // and it owns the pill state via its own guarded setter. This keeps the
  // effect free of synchronous setState calls (per React's rules-of-effects).
  const firstMsgId = messages[0]?.id ?? "";
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    pinnedRef.current = true;
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll"));
  }, [firstMsgId]);

  // On new content, only scroll when pinned. Use scrollHeight after the
  // DOM has flushed so we land on the latest message, not its predecessor.
  useLayoutEffect(() => {
    const el = messagesRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const jumpToLatest = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setShowJumpPill(false);
  }, []);

  return (
    <section
      className="ehv2-card-up relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      style={{
        background: "white",
        borderRadius: 13,
        border: "0.5px solid rgba(0,0,0,0.08)",
        animationDelay: delay,
      }}
    >
      {/* Card header */}
      <div
        className="flex items-center gap-2"
        style={{
          padding: "11px 16px",
          borderBottom: "0.5px solid rgba(0,0,0,0.08)",
        }}
      >
        <StreamStatusDot status={streamStatus} working={isAgentWorking} />
        <span
          style={{ fontSize: 12, fontWeight: 600, color: "#1d1d1f", flex: 1 }}
        >
          Resolution agent
        </span>
        <span style={{ fontSize: 11, color: "#aeaeb2" }}>{updatedAt}</span>
      </div>

      {/* Messages area */}
      <div
        ref={messagesRef}
        className="min-h-0 flex-1 overflow-y-auto"
        style={{ padding: "12px 16px" }}
      >
        {earlierCount > 0 ? (
          <HistoryToggle
            count={earlierCount}
            open={historyOpen}
            onToggle={onToggleHistory}
          />
        ) : null}

        {messages.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: "#aeaeb2",
              textAlign: "center",
              padding: "24px 0",
            }}
          >
            No messages yet.
          </div>
        ) : null}

        <div className="flex flex-col" style={{ gap: 10 }}>
          {messages.map((m, i) => {
            const key = m.id || `m-${i}`;
            if (m.kind === "thinking") {
              return <ThinkingTrace key={key} message={m} />;
            }
            if (m.kind === "tool-call") {
              return <ToolCallTrace key={key} message={m} />;
            }
            if (m.kind === "system-error") {
              return <SystemErrorTrace key={key} message={m} />;
            }
            return (
              <ChatBubble
                key={key}
                message={m}
                updatedAt={updatedAt}
                latestRelatedOutputsKey={latestRelatedOutputsKey}
                disabled={replyBusy}
                runId={runId}
                onOpenDocumentViewer={onOpenDocumentViewer}
                onSendRaw={onSendRaw}
                onSelectChoice={onSelectChoice}
                onRetryOptimistic={onRetryOptimistic}
              />
            );
          })}
          {isAgentWorking ? (
            <div
              className="flex items-center gap-2"
              style={{ fontSize: 11.5, color: "#aeaeb2" }}
            >
              <Loader2 className="size-3 animate-spin" />
              Agent is thinking…
            </div>
          ) : null}
        </div>

        {paused ? <DividerNote text="Automation paused · awaiting guidance" /> : null}
      </div>

      {/* Jump-to-latest pill — overlays the bottom of the message area when
          the user has scrolled away. Centered, just above the compose row. */}
      {showJumpPill ? (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/40"
          style={{
            left: "50%",
            transform: "translateX(-50%)",
            // ~58px above the bottom = above the compose row.
            bottom: 64,
            background: "white",
            border: "0.5px solid rgba(0,0,0,0.12)",
            borderRadius: 9999,
            padding: "5px 12px",
            fontSize: 11.5,
            fontWeight: 500,
            color: "#0071e3",
            boxShadow: "0 4px 12px rgba(0,0,0,0.10)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <ChevronRight
            size={11}
            strokeWidth={1.75}
            fill="none"
            style={{ transform: "rotate(90deg)" }}
          />
          Jump to latest
        </button>
      ) : null}

      {/* Compose row */}
      <div
        className="shrink-0"
        style={{
          padding: "10px 12px",
          borderTop: "0.5px solid rgba(0,0,0,0.08)",
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={taRef}
            placeholder="Tell the agent how to resolve this…"
            value={replyText}
            onChange={(e) => onChangeReplyText(e.target.value)}
            onInput={(e) => autoGrow(e.currentTarget)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!replyBusy && replyText.trim()) onSubmitReply();
              }
            }}
            rows={1}
            style={{
              flex: 1,
              background: "rgba(118,118,128,0.10)",
              border: "none",
              borderRadius: 10,
              padding: "8px 12px",
              minHeight: 36,
              maxHeight: 90,
              resize: "none",
              outline: "none",
              fontSize: 13,
              color: "#1d1d1f",
              fontFamily: "inherit",
              lineHeight: 1.4,
            }}
          />
          {isAgentWorking ? (
            <button
              type="button"
              aria-label="Stop generation"
              onClick={onStop}
              disabled={stopBusy}
              className="flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-[#ff3b30]/40"
              style={{
                width: 32,
                height: 32,
                borderRadius: 9999,
                background: "white",
                color: "#1d1d1f",
                border: "0.5px solid rgba(0,0,0,0.18)",
                boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                opacity: stopBusy ? 0.6 : 1,
                cursor: stopBusy ? "wait" : "pointer",
                transition: "opacity 0.15s",
                flexShrink: 0,
              }}
              title="Stop the agent"
            >
              {stopBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <span
                  aria-hidden
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 2,
                    background: "#1d1d1f",
                    display: "block",
                  }}
                />
              )}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Send"
            onClick={onSubmitReply}
            disabled={replyBusy || !replyText.trim()}
            className="flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/40"
            style={{
              width: 32,
              height: 32,
              borderRadius: 9999,
              background: "#0071e3",
              color: "white",
              border: "none",
              boxShadow: "0 2px 8px rgba(0,113,227,0.28)",
              opacity: replyBusy || !replyText.trim() ? 0.55 : 1,
              cursor:
                replyBusy || !replyText.trim() ? "not-allowed" : "pointer",
              transition: "opacity 0.15s",
              flexShrink: 0,
            }}
          >
            {replyBusy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send size={14} strokeWidth={1.75} fill="none" />
            )}
          </button>
        </div>
        {replyError ? (
          <p
            style={{
              fontSize: 11,
              color: "#b91c1c",
              marginTop: 6,
              overflowWrap: "anywhere",
            }}
          >
            {replyError}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function InlineErrorBanner({
  message,
  onRetry,
  label,
}: {
  message: string;
  onRetry: () => void;
  label: string;
}) {
  return (
    <div
      role="alert"
      className="flex min-w-0 items-start gap-2"
      style={{
        background: "rgba(255,59,48,0.06)",
        border: "0.5px solid rgba(255,59,48,0.20)",
        borderRadius: 10,
        padding: "8px 10px",
        margin: "8px 0",
      }}
    >
      <AlertCircle
        size={13}
        strokeWidth={1.75}
        style={{ color: "#b91c1c", marginTop: 1, flexShrink: 0 }}
      />
      <div className="min-w-0 flex-1">
        <p
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: "#7f1d1d",
            margin: 0,
          }}
        >
          {label}
        </p>
        <p
          style={{
            fontSize: 11,
            color: "#7f1d1d",
            margin: "2px 0 0",
            overflowWrap: "anywhere",
            opacity: 0.85,
          }}
        >
          {message}
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex shrink-0 items-center gap-1 outline-none focus-visible:underline"
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "#0071e3",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <RefreshCw size={10} strokeWidth={1.75} />
        Retry
      </button>
    </div>
  );
}

function InlineWarningBanner({
  label,
  message,
  actionLabel,
  onAction,
}: {
  label: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div
      role="status"
      className="flex min-w-0 items-start gap-2"
      style={{
        background: "rgba(245,158,11,0.07)",
        border: "0.5px solid rgba(245,158,11,0.25)",
        borderRadius: 10,
        padding: "8px 10px",
        margin: "8px 0",
      }}
    >
      <AlertCircle
        size={13}
        strokeWidth={1.75}
        style={{ color: "#92400e", marginTop: 1, flexShrink: 0 }}
      />
      <div className="min-w-0 flex-1">
        <p
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: "#78350f",
            margin: 0,
          }}
        >
          {label}
        </p>
        <p
          style={{
            fontSize: 11,
            color: "#78350f",
            margin: "2px 0 0",
            overflowWrap: "anywhere",
            opacity: 0.85,
          }}
        >
          {message}
        </p>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="inline-flex shrink-0 items-center gap-1 outline-none focus-visible:underline"
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "#0071e3",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <RefreshCw size={10} strokeWidth={1.75} />
        {actionLabel}
      </button>
    </div>
  );
}

function HistoryToggle({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  const label = open
    ? `Hide ${count} earlier ${count === 1 ? "message" : "messages"}`
    : `Show ${count} earlier ${count === 1 ? "message" : "messages"}`;
  return (
    <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
      <span
        aria-hidden
        style={{ flex: 1, height: "0.5px", background: "rgba(0,0,0,0.08)" }}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1 outline-none focus-visible:underline"
        style={{
          fontSize: 11.5,
          fontWeight: 500,
          color: "#0071e3",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <ChevronRight
          size={11}
          strokeWidth={1.75}
          fill="none"
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }}
        />
        {label}
      </button>
      <span
        aria-hidden
        style={{ flex: 1, height: "0.5px", background: "rgba(0,0,0,0.08)" }}
      />
    </div>
  );
}

function DividerNote({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2" style={{ marginTop: 12 }}>
      <span
        aria-hidden
        style={{
          flex: 1,
          height: "0.5px",
          background: "rgba(0,0,0,0.08)",
        }}
      />
      <span
        style={{
          fontSize: 11,
          color: "#aeaeb2",
          padding: "0 4px",
        }}
      >
        {text}
      </span>
      <span
        aria-hidden
        style={{
          flex: 1,
          height: "0.5px",
          background: "rgba(0,0,0,0.08)",
        }}
      />
    </div>
  );
}

/**
 * Tiny status dot for the chat header. Maps the SSE connection state
 * (and "agent working" flag) to a color + tooltip so operators can tell
 * at a glance whether they're seeing real-time updates.
 */
function StreamStatusDot({
  status,
  working,
}: {
  status: ExceptionStreamStatus;
  working: boolean;
}) {
  let color: string;
  let label: string;
  let pulse = false;
  if (status === "connecting") {
    color = "#f59e0b";
    label = "Connecting to live stream…";
    pulse = true;
  } else if (status === "retrying") {
    color = "#f59e0b";
    label = "Reconnecting to live stream…";
    pulse = true;
  } else if (status === "fallback") {
    color = "#ff3b30";
    label = "Live stream unavailable — falling back to polling";
  } else if (status === "open") {
    color = working ? "#0071e3" : "#34c759";
    label = working ? "Live stream connected — agent working" : "Live stream connected";
    pulse = working;
  } else if (status === "closed") {
    color = "#34c759";
    label = "Idle — agent has finished this turn";
  } else {
    color = "#aeaeb2";
    label = "Stream idle";
  }
  return (
    <span
      title={label}
      aria-label={label}
      style={{
        position: "relative",
        width: 6,
        height: 6,
        borderRadius: 9999,
        background: color,
        // `color` is read by the keyframe's `currentColor` to drive the
        // outward ring without hard-coding a per-state animation.
        color,
        flexShrink: 0,
        animation: pulse ? "ehv2-pulse 1.6s ease-out infinite" : undefined,
      }}
    />
  );
}

function MessageBody({ content }: { content: string }) {
  if (!content) return null;
  return (
    <>
      {content.split(/\n+/).map((line, i) => (
        <p
          key={i}
          style={{
            margin: i === 0 ? 0 : "8px 0 0",
            overflowWrap: "anywhere",
          }}
        >
          <MonoBracketedText text={line} />
        </p>
      ))}
    </>
  );
}

/**
 * One-line italicized "thinking" trace. We strip mostly-empty content so
 * placeholder thinking events from the stream don't visually multiply.
 */
function ThinkingTrace({ message }: { message: ChatThinkingMessage }) {
  const text = (message.content ?? "").trim();
  if (!text) return null;
  return (
    <div
      className="flex items-start gap-2"
      style={{
        fontSize: 11.5,
        color: "#8e8e93",
        fontStyle: "italic",
        lineHeight: 1.5,
        padding: "0 4px",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 4,
          height: 4,
          borderRadius: 9999,
          background: "#c7c7cc",
          marginTop: 7,
          flexShrink: 0,
        }}
      />
      <span style={{ overflowWrap: "anywhere" }}>{text}</span>
    </div>
  );
}

/**
 * Compact tool-call card. Shows the tool name, an "in progress" or
 * "Done · Ns" indicator, and (when the user expands) the input/result
 * payload. Result is collapsed so noisy tool blobs don't dominate the
 * transcript.
 */
function ToolCallTrace({ message }: { message: ChatToolCallMessage }) {
  const [open, setOpen] = useState(false);
  const inProgress = message.isStreaming || !message.result;
  const elapsed = (() => {
    if (!message.createTime || !message.resultTime) return null;
    const start = new Date(message.createTime).getTime();
    const end = new Date(message.resultTime).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    const sec = Math.max(1, Math.round((end - start) / 1000));
    return `${sec}s`;
  })();
  const hasDetail = Boolean(message.input || message.result);

  return (
    <div
      style={{
        background: "rgba(118,118,128,0.06)",
        border: "0.5px solid rgba(0,0,0,0.06)",
        borderRadius: 9,
        padding: "7px 10px",
        fontSize: 11.5,
        color: "#3f3f46",
      }}
    >
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        disabled={!hasDetail}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left outline-none focus-visible:underline"
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          color: "inherit",
          cursor: hasDetail ? "pointer" : "default",
        }}
      >
        {inProgress ? (
          <Loader2 className="size-3 shrink-0 animate-spin" style={{ color: "#0071e3" }} />
        ) : (
          <CheckCircle2
            size={11}
            strokeWidth={1.75}
            fill="none"
            style={{ color: "#34c759", flexShrink: 0 }}
          />
        )}
        <span style={{ fontWeight: 500, flex: 1, overflowWrap: "anywhere" }}>
          {message.displayName || "Tool call"}
        </span>
        <span style={{ color: "#aeaeb2" }}>
          {inProgress ? "Running…" : elapsed ? `Done · ${elapsed}` : "Done"}
        </span>
        {hasDetail ? (
          <ChevronRight
            size={11}
            strokeWidth={1.75}
            fill="none"
            style={{
              color: "#aeaeb2",
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.15s",
              flexShrink: 0,
            }}
          />
        ) : null}
      </button>
      {open && hasDetail ? (
        <div style={{ marginTop: 7 }}>
          {message.input ? (
            <ToolCallSection label="Input" body={message.input} />
          ) : null}
          {message.result ? (
            <ToolCallSection label="Result" body={message.result} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ToolCallSection({ label, body }: { label: string; body: string }) {
  return (
    <div style={{ marginTop: 4 }}>
      <p
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "#aeaeb2",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          margin: "4px 0 2px",
        }}
      >
        {label}
      </p>
      <pre
        style={{
          margin: 0,
          padding: "6px 8px",
          background: "white",
          border: "0.5px solid rgba(0,0,0,0.05)",
          borderRadius: 6,
          fontFamily:
            "var(--font-dm-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 10.5,
          lineHeight: 1.4,
          color: "#3f3f46",
          maxHeight: 160,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {body}
      </pre>
    </div>
  );
}

/**
 * Inline system error trace (rare — usually surfaced as `replyError`,
 * but Kognitos sometimes emits one mid-conversation).
 */
function SystemErrorTrace({ message }: { message: ChatSystemErrorMessage }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2"
      style={{
        background: "rgba(255,59,48,0.06)",
        border: "0.5px solid rgba(255,59,48,0.20)",
        borderRadius: 9,
        padding: "7px 10px",
        fontSize: 11.5,
        color: "#7f1d1d",
        lineHeight: 1.45,
      }}
    >
      <AlertCircle
        size={12}
        strokeWidth={1.75}
        style={{ color: "#b91c1c", marginTop: 2, flexShrink: 0 }}
      />
      <div className="min-w-0 flex-1" style={{ overflowWrap: "anywhere" }}>
        <span style={{ fontWeight: 600 }}>{message.message}</span>
        {message.detail ? (
          <span style={{ display: "block", marginTop: 2, opacity: 0.85 }}>
            {message.detail}
          </span>
        ) : null}
      </div>
    </div>
  );
}

type ChatBubbleProps = {
  message: ChatTextMessage;
  updatedAt: string;
  latestRelatedOutputsKey: string | null;
  disabled: boolean;
  /** Exception's `runId` (when known) — gates the highlight-viewer dialog. */
  runId: string | null;
  /** Open the page-level highlight-viewer dialog for a chat attachment. */
  onOpenDocumentViewer: (args: ChatDocumentViewerOpen) => void;
  onSendRaw: (content: string) => Promise<boolean>;
  onSelectChoice: (value: string) => void;
  onRetryOptimistic: (id: string) => void;
};

function ChatBubble({
  message,
  updatedAt,
  latestRelatedOutputsKey,
  disabled,
  runId,
  onOpenDocumentViewer,
  onSendRaw,
  onSelectChoice,
  onRetryOptimistic,
}: ChatBubbleProps) {
  const isUser = message.role === "user";
  const senderLabel = isUser ? "You" : "Automation";
  const ts = message.createTime ? shortAge(message.createTime) : updatedAt;
  const hasWidgets = message.widgets.length > 0;
  const hasContent = !!message.content?.trim();

  // Status-driven UI for outgoing user bubbles.
  const status = message.status;
  const sending = status === "sending";
  const failed = status === "failed";

  if (isUser) {
    // If a user message is widget-only (e.g. an `edit_facts` XML reply),
    // render JUST the widget(s) — no empty blue bubble.
    if (!hasContent && hasWidgets) {
      return (
        <div className="flex flex-col items-end" style={{ gap: 6 }}>
          <WidgetList
            messageId={message.id}
            widgets={message.widgets}
            latestRelatedOutputsKey={latestRelatedOutputsKey}
            disabled={disabled}
            runId={runId}
            onOpenDocumentViewer={onOpenDocumentViewer}
            onSendRaw={onSendRaw}
            onSelectChoice={onSelectChoice}
            align="end"
          />
        </div>
      );
    }
    return (
      <div className="flex flex-col items-end" style={{ gap: 6 }}>
        <div
          style={{
            background: failed ? "rgba(255,59,48,0.07)" : "rgba(0,113,227,0.10)",
            color: failed ? "#7f1d1d" : "#0c2960",
            borderRadius: "12px 12px 3px 12px",
            padding: "10px 13px",
            maxWidth: "94%",
            fontSize: 12.5,
            lineHeight: 1.5,
            overflowWrap: "anywhere",
            opacity: sending ? 0.85 : 1,
            border: failed ? "0.5px solid rgba(255,59,48,0.25)" : undefined,
          }}
        >
          <div
            className="flex items-center gap-1.5"
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: failed ? "#9f1239" : "#7689a8",
              marginBottom: 4,
            }}
          >
            <span>{senderLabel}</span>
            <span>·</span>
            <span>{ts}</span>
            {sending ? (
              <>
                <span>·</span>
                <Loader2 className="size-2.5 animate-spin" />
                <span>Sending</span>
              </>
            ) : null}
            {failed ? (
              <>
                <span>·</span>
                <AlertCircle size={10} strokeWidth={1.75} />
                <span>Failed</span>
              </>
            ) : null}
          </div>
          <MessageBody content={message.content} />
          {failed ? (
            <button
              type="button"
              onClick={() => onRetryOptimistic(message.id)}
              className="mt-1.5 inline-flex items-center gap-1 outline-none focus-visible:underline"
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "#0071e3",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            >
              <RefreshCw size={10} strokeWidth={1.75} />
              Retry
            </button>
          ) : null}
        </div>
        {hasWidgets ? (
          <WidgetList
            messageId={message.id}
            widgets={message.widgets}
            latestRelatedOutputsKey={latestRelatedOutputsKey}
            disabled={disabled}
            runId={runId}
            onOpenDocumentViewer={onOpenDocumentViewer}
            onSendRaw={onSendRaw}
            onSelectChoice={onSelectChoice}
            align="end"
          />
        ) : null}
      </div>
    );
  }

  // Agent-side bubble.
  return (
    <div className="flex flex-col" style={{ gap: 6 }}>
      {hasContent ? (
        <div
          style={{
            background: "rgba(118,118,128,0.10)",
            borderRadius: "12px 12px 12px 3px",
            padding: "10px 13px",
            maxWidth: "94%",
            fontSize: 12.5,
            color: "#6e6e73",
            lineHeight: 1.5,
            overflowWrap: "anywhere",
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: "#aeaeb2",
              marginBottom: 4,
            }}
          >
            {senderLabel} · {ts}
          </div>
          <MessageBody content={message.content} />
        </div>
      ) : null}
      {hasWidgets ? (
        <WidgetList
          messageId={message.id}
          widgets={message.widgets}
          latestRelatedOutputsKey={latestRelatedOutputsKey}
          disabled={disabled}
          runId={runId}
          onOpenDocumentViewer={onOpenDocumentViewer}
          onSendRaw={onSendRaw}
          onSelectChoice={onSelectChoice}
          align="start"
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Collapsibles + key/value list
// ─────────────────────────────────────────────────────────────────

function Collapsible({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderTop: "0.5px solid rgba(0,0,0,0.08)" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left outline-none focus-visible:bg-black/[0.03]"
        style={{
          padding: "10px 16px",
          fontSize: 12.5,
          fontWeight: 500,
          color: "#6e6e73",
          background: "transparent",
          border: "none",
          cursor: "pointer",
        }}
      >
        <ChevronRight
          size={13}
          strokeWidth={1.75}
          fill="none"
          aria-hidden
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.18s ease",
          }}
        />
        {label}
      </button>
      {open ? (
        <div
          style={{
            padding: "0 16px 12px 33px",
            fontSize: 12,
            color: "#6e6e73",
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function KeyValueList({
  rows,
}: {
  rows: Array<{ k: string; v: string; mono?: boolean }>;
}) {
  return (
    <dl className="grid" style={{ gridTemplateColumns: "auto 1fr", gap: "6px 12px" }}>
      {rows.map((r) => (
        <div key={r.k} style={{ display: "contents" }}>
          <dt style={{ color: "#aeaeb2", fontSize: 11.5 }}>{r.k}</dt>
          <dd
            style={{
              color: "#1d1d1f",
              fontSize: 12,
              margin: 0,
              fontFamily: r.mono ? "var(--font-mono)" : undefined,
              overflowWrap: "anywhere",
            }}
          >
            {r.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ─────────────────────────────────────────────────────────────────
// Chat widgets (v2 design)
// ─────────────────────────────────────────────────────────────────

type WidgetListProps = {
  messageId: string;
  widgets: ChatWidget[];
  latestRelatedOutputsKey: string | null;
  disabled: boolean;
  /** Exception's `runId` (when known) — gates the highlight-viewer dialog. */
  runId: string | null;
  /** Open the page-level highlight-viewer dialog for a chat attachment. */
  onOpenDocumentViewer: (args: ChatDocumentViewerOpen) => void;
  onSendRaw: (content: string) => Promise<boolean>;
  onSelectChoice: (value: string) => void;
  /** Bubble alignment — used so the widget shares the bubble's edge. */
  align: "start" | "end";
};

function WidgetList({
  messageId,
  widgets,
  latestRelatedOutputsKey,
  disabled,
  runId,
  onOpenDocumentViewer,
  onSendRaw,
  onSelectChoice,
  align,
}: WidgetListProps) {
  return (
    <div
      className={cn(
        "flex flex-col",
        align === "end" ? "items-end" : "items-start",
      )}
      style={{ gap: 6, maxWidth: "94%", alignSelf: align === "end" ? "flex-end" : "flex-start" }}
    >
      {widgets.map((w, i) => {
        const key = `${messageId}#${i}`;
        return (
          <ChatWidgetRenderer
            key={key}
            widget={w}
            interactive={key === latestRelatedOutputsKey}
            disabled={disabled}
            runId={runId}
            onOpenDocumentViewer={onOpenDocumentViewer}
            onSendRaw={onSendRaw}
            onSelectChoice={onSelectChoice}
          />
        );
      })}
    </div>
  );
}

type WidgetRendererProps = {
  widget: ChatWidget;
  /** True only for the most recent `related-outputs` widget. */
  interactive: boolean;
  disabled: boolean;
  /** Exception's `runId` (when known) — gates the highlight-viewer dialog. */
  runId: string | null;
  /** Open the page-level highlight-viewer dialog for a chat attachment. */
  onOpenDocumentViewer: (args: ChatDocumentViewerOpen) => void;
  onSendRaw: (content: string) => Promise<boolean>;
  onSelectChoice: (value: string) => void;
};

function ChatWidgetRenderer({
  widget,
  interactive,
  disabled,
  runId,
  onOpenDocumentViewer,
  onSendRaw,
  onSelectChoice,
}: WidgetRendererProps) {
  if (widget.kind === "related-outputs") {
    return (
      <V2RelatedOutputsCard
        data={widget.data}
        interactive={interactive}
        disabled={disabled}
        onSendRaw={onSendRaw}
      />
    );
  }
  if (widget.kind === "guide-entry") {
    return <V2GuideEntryCard data={widget.data} />;
  }
  if (widget.kind === "edit-facts") {
    return <V2EditFactsCard facts={widget.data} />;
  }
  if (widget.kind === "button-group") {
    return (
      <V2ButtonGroupCard
        choice={widget.data}
        disabled={disabled}
        onSelect={onSelectChoice}
      />
    );
  }
  if (widget.kind === "form-fields") {
    return (
      <V2FormFieldsCard
        data={widget.data}
        disabled={disabled || !interactive}
        onSubmit={onSendRaw}
      />
    );
  }
  return (
    <V2DocumentPreviewCard
      data={widget.data}
      runId={runId}
      onOpenDocumentViewer={onOpenDocumentViewer}
    />
  );
}

// — Shared visual primitives ─────────────────────────────────────

const V2_WIDGET_CARD_STYLE: React.CSSProperties = {
  background: "white",
  border: "0.5px solid rgba(0,0,0,0.08)",
  borderRadius: 12,
  padding: "11px 14px",
  fontSize: 12.5,
  color: "#1d1d1f",
  width: "100%",
  minWidth: 0,
  maxWidth: 460,
};

function V2WidgetLabel({
  icon,
  text,
  trailing,
  color = "#6e6e73",
}: {
  icon: React.ReactNode;
  text: string;
  trailing?: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span style={{ color }} aria-hidden>
        {icon}
      </span>
      <span
        className="min-w-0 flex-1 truncate"
        style={{ color: "#1d1d1f", fontSize: 12, fontWeight: 600 }}
      >
        {text}
      </span>
      {trailing ? (
        <span
          className="shrink-0"
          style={{
            color: "#aeaeb2",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
          }}
        >
          {trailing}
        </span>
      ) : null}
    </div>
  );
}

// — Related outputs ──────────────────────────────────────────────

function V2RelatedOutputsCard({
  data,
  interactive,
  disabled,
  onSendRaw,
}: {
  data: ParsedRelatedOutputs;
  interactive: boolean;
  disabled: boolean;
  onSendRaw: (content: string) => Promise<boolean>;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const totalFacts = data.facts.length;
  const missingCount = data.facts.filter((f) => f.status === "missing").length;
  const presentCount = totalFacts - missingCount;
  const title = relatedOutputsTitle(data.context);
  const summary = totalFacts > 0 ? `${presentCount} present · ${missingCount} missing` : "—";

  // Read-only historical payload → collapsed summary, click to expand.
  if (!interactive && !historyOpen) {
    return (
      <button
        type="button"
        onClick={() => setHistoryOpen(true)}
        className="flex w-full min-w-0 items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
        style={{
          ...V2_WIDGET_CARD_STYLE,
          padding: "9px 12px",
          textAlign: "left",
          cursor: "pointer",
        }}
        aria-expanded={false}
      >
        <FileText size={13} strokeWidth={1.75} fill="none" style={{ color: "#aeaeb2" }} />
        <span
          className="min-w-0 flex-1 truncate"
          style={{ fontSize: 12, fontWeight: 500, color: "#6e6e73" }}
        >
          {title}
        </span>
        <span
          className="shrink-0"
          style={{
            fontSize: 10,
            color: "#aeaeb2",
            fontFamily: "var(--font-mono)",
          }}
        >
          {summary}
        </span>
        <ChevronRight size={12} strokeWidth={1.75} style={{ color: "#aeaeb2" }} />
      </button>
    );
  }

  return (
    <V2RelatedOutputsBody
      data={data}
      interactive={interactive}
      disabled={disabled}
      onSendRaw={onSendRaw}
    />
  );
}

function V2RelatedOutputsBody({
  data,
  interactive,
  disabled,
  onSendRaw,
}: {
  data: ParsedRelatedOutputs;
  interactive: boolean;
  disabled: boolean;
  onSendRaw: (content: string) => Promise<boolean>;
}) {
  const totalFacts = data.facts.length;
  const missingCount = data.facts.filter((f) => f.status === "missing").length;
  const presentCount = totalFacts - missingCount;
  const hasMissing = missingCount > 0;
  const allowEditing = interactive && hasMissing;

  const identityKey = useMemo(() => relatedOutputsIdentityKey(data), [data]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

  // Reset transient state when the underlying payload changes.
  useEffect(() => {
    setEdits({});
    setSubmitError(null);
    setJustSubmitted(false);
  }, [identityKey]);

  const filledCount = useMemo(
    () =>
      Object.values(edits).reduce(
        (acc, v) => acc + (v.trim().length > 0 ? 1 : 0),
        0,
      ),
    [edits],
  );
  const canSubmit = allowEditing && !disabled && !submitting && filledCount > 0;

  const handleSave = useCallback(async () => {
    if (!canSubmit) return;
    const xml = buildEditFactsXmlFromRelatedOutputs(data, edits);
    if (!xml) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const ok = await onSendRaw(xml);
      if (ok) {
        setJustSubmitted(true);
        setEdits({});
      } else {
        setSubmitError("Could not send. Check the message panel below.");
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "send_failed");
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, data, edits, onSendRaw]);

  return (
    <div style={V2_WIDGET_CARD_STYLE} role="group" aria-label={relatedOutputsTitle(data.context)}>
      <V2WidgetLabel
        icon={<FileText size={13} strokeWidth={1.75} fill="none" />}
        text={relatedOutputsTitle(data.context)}
        trailing={totalFacts > 0 ? `${presentCount} present · ${missingCount} missing` : undefined}
      />
      {data.factGroups.length === 0 ? (
        <p style={{ marginTop: 6, color: "#aeaeb2", fontSize: 11.5 }}>
          No fields were extracted.
        </p>
      ) : (
        <ul className="flex flex-col" style={{ gap: 8, marginTop: 8, listStyle: "none", padding: 0 }}>
          {data.factGroups.map((group, gi) => {
            const sourceLabel = shortFactSourceLabel(group.source?.name);
            return (
              <li key={gi} className="min-w-0">
                {sourceLabel || group.source?.page !== undefined ? (
                  <p
                    className="truncate"
                    style={{
                      fontSize: 11,
                      color: "#aeaeb2",
                      marginBottom: 4,
                    }}
                  >
                    {sourceLabel ?? "Source"}
                    {group.source?.page !== undefined ? ` · p. ${group.source.page}` : ""}
                  </p>
                ) : null}
                <ul
                  className="flex flex-col"
                  style={{
                    border: "0.5px solid rgba(0,0,0,0.08)",
                    borderRadius: 8,
                    background: "rgba(118,118,128,0.04)",
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                  }}
                >
                  {group.facts.map((f, fi) => (
                    <li
                      key={`${gi}-${fi}`}
                      className="flex min-w-0 flex-col"
                      style={{
                        padding: "6px 10px",
                        borderTop: fi === 0 ? "none" : "0.5px solid rgba(0,0,0,0.06)",
                        gap: 4,
                      }}
                    >
                      {f.status === "missing" && allowEditing ? (
                        <V2EditableMissingFact
                          fact={f}
                          value={edits[f.field] ?? ""}
                          onChange={(v) =>
                            setEdits((prev) => ({ ...prev, [f.field]: v }))
                          }
                          disabled={disabled || submitting}
                          onSubmit={handleSave}
                        />
                      ) : (
                        <div className="flex min-w-0 items-baseline gap-2">
                          <span
                            className="min-w-0 flex-1 truncate"
                            style={{
                              fontSize: 12,
                              fontWeight: 500,
                              color: "#6e6e73",
                            }}
                          >
                            {f.field}
                          </span>
                          {f.status === "missing" ? (
                            <span
                              style={{
                                fontSize: 11,
                                color: "#aeaeb2",
                                fontStyle: "italic",
                              }}
                            >
                              missing
                            </span>
                          ) : (
                            <span
                              className="truncate text-right"
                              style={{
                                maxWidth: "62%",
                                fontFamily: "var(--font-mono)",
                                fontSize: 11.5,
                                color: "#1d1d1f",
                              }}
                            >
                              {f.value ?? ""}
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      {allowEditing ? (
        <div
          className="flex flex-col"
          style={{
            marginTop: 10,
            paddingTop: 10,
            borderTop: "0.5px solid rgba(0,0,0,0.08)",
            gap: 6,
          }}
        >
          {submitError ? (
            <p style={{ fontSize: 11, color: "#b91c1c", margin: 0 }}>{submitError}</p>
          ) : null}
          {justSubmitted && filledCount === 0 ? (
            <p style={{ fontSize: 11, color: "#aeaeb2", margin: 0 }}>
              Sent. The agent will respond shortly.
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <span style={{ fontSize: 11, color: "#aeaeb2" }}>
              {filledCount === 0
                ? `Fill in the ${missingCount === 1 ? "field" : `${missingCount} fields`} to send`
                : `${filledCount} of ${missingCount} ready to send`}
            </span>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void handleSave()}
              className="inline-flex items-center justify-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/40"
              style={{
                background: canSubmit ? "#0071e3" : "rgba(0,0,0,0.05)",
                color: canSubmit ? "white" : "#aeaeb2",
                border: "none",
                borderRadius: 8,
                padding: "5px 12px",
                fontSize: 12,
                fontWeight: 500,
                cursor: canSubmit ? "pointer" : "not-allowed",
                minWidth: 80,
                transition: "background 0.15s",
              }}
            >
              {submitting ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Send size={11} strokeWidth={1.75} fill="none" />
              )}
              {submitting ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function V2EditableMissingFact({
  fact,
  value,
  onChange,
  disabled,
  onSubmit,
}: {
  fact: ParsedFact;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  onSubmit: () => void;
}) {
  const inputId = `v2-fact-${fact.field}`;
  const inputMode: "text" | "decimal" =
    fact.type.toLowerCase() === "number" ? "decimal" : "text";
  return (
    <div className="flex min-w-0 flex-col" style={{ gap: 3 }}>
      <label
        htmlFor={inputId}
        style={{ fontSize: 11.5, fontWeight: 500, color: "#6e6e73" }}
      >
        {fact.field}
        <span style={{ marginLeft: 6, fontSize: 10, color: "#aeaeb2", fontStyle: "italic" }}>
          missing
        </span>
      </label>
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Enter ${fact.field}`}
        disabled={disabled}
        inputMode={inputMode}
        aria-label={`Value for ${fact.field}`}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
        style={{
          background: "white",
          border: "0.5px solid rgba(0,0,0,0.12)",
          borderRadius: 7,
          padding: "5px 9px",
          fontSize: 12,
          color: "#1d1d1f",
          outline: "none",
          fontFamily: "inherit",
          width: "100%",
          minWidth: 0,
          opacity: disabled ? 0.6 : 1,
        }}
      />
    </div>
  );
}

// — Guide entry ──────────────────────────────────────────────────

function V2GuideEntryCard({ data }: { data: ParsedGuideEntry }) {
  const actionLabel =
    data.action === "create"
      ? "Proposed troubleshooting guide"
      : data.action === "update"
        ? "Updated troubleshooting guide"
        : "Applied troubleshooting guide";
  const stateLabel = data.state ? data.state.replace(/^STATE_/, "") : null;
  const resolution = data.resolutionSteps ?? data.legacyContent ?? "";

  return (
    <div style={V2_WIDGET_CARD_STYLE} role="group" aria-label={actionLabel}>
      <V2WidgetLabel
        icon={<BookOpen size={13} strokeWidth={1.75} fill="none" />}
        text={actionLabel}
        trailing={data.version ? `v${data.version}` : undefined}
      />
      {stateLabel ? (
        <span
          style={{
            display: "inline-block",
            marginTop: 6,
            border: "0.5px solid rgba(0,0,0,0.08)",
            background: "rgba(118,118,128,0.06)",
            color: "#6e6e73",
            borderRadius: 9999,
            padding: "1px 8px",
            fontSize: 9.5,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          {stateLabel}
        </span>
      ) : null}
      <p
        style={{
          marginTop: 6,
          fontSize: 12.5,
          fontWeight: 500,
          color: "#1d1d1f",
          overflowWrap: "anywhere",
        }}
      >
        {data.title}
      </p>
      {data.rootCause ? (
        <V2GuideSection label="Root cause" body={data.rootCause} />
      ) : null}
      {resolution ? <V2GuideSection label="Resolution" body={resolution} /> : null}
    </div>
  );
}

function V2GuideSection({ label, body }: { label: string; body: string }) {
  return (
    <div style={{ marginTop: 10 }}>
      <p
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "#aeaeb2",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          margin: 0,
        }}
      >
        {label}
      </p>
      <p
        style={{
          marginTop: 3,
          fontSize: 12,
          color: "#6e6e73",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {body}
      </p>
    </div>
  );
}

// — Edit-facts (echo of user's submitted edits) ──────────────────

function V2EditFactsCard({ facts }: { facts: EditedFact[] }) {
  if (facts.length === 0) return null;
  return (
    <div style={V2_WIDGET_CARD_STYLE} role="group" aria-label="Edited fields">
      <V2WidgetLabel
        icon={<Pencil size={13} strokeWidth={1.75} fill="none" />}
        text={`Edited ${facts.length === 1 ? "field" : `${facts.length} fields`}`}
      />
      <ul
        className="flex flex-col"
        style={{
          marginTop: 8,
          border: "0.5px solid rgba(0,0,0,0.08)",
          borderRadius: 8,
          background: "rgba(118,118,128,0.04)",
          listStyle: "none",
          padding: 0,
        }}
      >
        {facts.map((f, i) => (
          <li
            key={`${f.name}-${i}`}
            className="flex min-w-0 flex-col"
            style={{
              padding: "6px 10px",
              borderTop: i === 0 ? "none" : "0.5px solid rgba(0,0,0,0.06)",
              gap: 2,
            }}
          >
            <div className="flex min-w-0 items-baseline gap-2">
              <span
                className="min-w-0 flex-1 truncate"
                style={{ fontSize: 12, fontWeight: 500, color: "#6e6e73" }}
              >
                {f.name}
              </span>
              <span
                className="truncate text-right"
                style={{
                  maxWidth: "62%",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11.5,
                  color: "#1d1d1f",
                }}
              >
                {f.value}
              </span>
            </div>
            {f.original && f.original !== f.value ? (
              <p
                className="truncate text-right"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "#aeaeb2",
                  textDecoration: "line-through",
                  margin: 0,
                }}
              >
                was {f.original}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// — Button group (suggested replies) ─────────────────────────────

function V2ButtonGroupCard({
  choice,
  disabled,
  onSelect,
}: {
  choice: ExceptionStructuredChoiceDto;
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <div style={V2_WIDGET_CARD_STYLE} role="group" aria-label="Suggested replies">
      <V2WidgetLabel
        icon={<Send size={12} strokeWidth={1.75} fill="none" />}
        text="Suggested replies"
      />
      <ul
        className="flex flex-col"
        style={{ marginTop: 8, gap: 6, listStyle: "none", padding: 0 }}
      >
        {choice.options.map((opt, i) => (
          <li key={`${i}:${opt.slice(0, 80)}`}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(opt)}
              className="w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
              style={{
                background: "white",
                border: "0.5px solid rgba(0,0,0,0.12)",
                borderRadius: 9,
                padding: "7px 11px",
                fontSize: 12,
                color: "#1d1d1f",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.55 : 1,
                lineHeight: 1.4,
              }}
              onMouseEnter={(e) => {
                if (disabled) return;
                e.currentTarget.style.background = "rgba(0,113,227,0.06)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "white";
              }}
            >
              {opt}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// — Form fields (inline data-entry form from the agent) ──────────

function V2FormFieldsCard({
  data,
  disabled,
  onSubmit,
}: {
  data: ChatFormFieldsData;
  disabled: boolean;
  onSubmit: (content: string) => Promise<boolean>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of data.fields) if (f.default !== undefined) init[f.name] = f.default;
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiredMissing = data.fields.some(
    (f) => f.required && !(values[f.name] ?? "").trim(),
  );

  async function send() {
    if (disabled || submitting || requiredMissing) return;
    setSubmitting(true);
    setError(null);
    try {
      const facts: BuildEditFactInput[] = data.fields
        .map<BuildEditFactInput | null>((f) => {
          const v = (values[f.name] ?? "").trim();
          if (!v) return null;
          return { name: f.name, value: v, type: f.type, original: f.default };
        })
        .filter((x): x is BuildEditFactInput => x !== null);
      const xml = buildEditFactsXml([{ facts }]);
      if (!xml) {
        setError("Nothing to submit.");
        return;
      }
      const ok = await onSubmit(xml);
      if (!ok) setError("Could not submit. See chat below.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "submit_failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={V2_WIDGET_CARD_STYLE} role="group" aria-label={data.title ?? "Form"}>
      <V2WidgetLabel
        icon={<Pencil size={13} strokeWidth={1.75} fill="none" />}
        text={data.title ?? "Form"}
      />
      {data.description ? (
        <p style={{ marginTop: 4, fontSize: 11.5, color: "#6e6e73" }}>
          {data.description}
        </p>
      ) : null}
      <div className="flex flex-col" style={{ marginTop: 10, gap: 8 }}>
        {data.fields.map((f) => (
          <V2FormField
            key={f.name}
            field={f}
            value={values[f.name] ?? ""}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))}
            disabled={disabled || submitting}
          />
        ))}
      </div>
      {error ? (
        <p style={{ marginTop: 8, fontSize: 11, color: "#b91c1c" }}>{error}</p>
      ) : null}
      <div className="flex items-center justify-end" style={{ marginTop: 10 }}>
        <button
          type="button"
          disabled={disabled || submitting || requiredMissing}
          onClick={() => void send()}
          className="inline-flex items-center justify-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/40"
          style={{
            background:
              !disabled && !submitting && !requiredMissing
                ? "#0071e3"
                : "rgba(0,0,0,0.05)",
            color:
              !disabled && !submitting && !requiredMissing ? "white" : "#aeaeb2",
            border: "none",
            borderRadius: 8,
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 500,
            cursor:
              !disabled && !submitting && !requiredMissing
                ? "pointer"
                : "not-allowed",
            minWidth: 80,
          }}
        >
          {submitting ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Send size={11} strokeWidth={1.75} fill="none" />
          )}
          {submitting ? "Sending…" : "Submit"}
        </button>
      </div>
    </div>
  );
}

function V2FormField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: ChatFormField;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const inputId = `v2-form-${field.name}`;
  const baseInputStyle: React.CSSProperties = {
    background: "white",
    border: "0.5px solid rgba(0,0,0,0.12)",
    borderRadius: 7,
    padding: "5px 9px",
    fontSize: 12,
    color: "#1d1d1f",
    outline: "none",
    fontFamily: "inherit",
    width: "100%",
    minWidth: 0,
    opacity: disabled ? 0.6 : 1,
  };
  return (
    <div className="flex min-w-0 flex-col" style={{ gap: 3 }}>
      <label
        htmlFor={inputId}
        style={{ fontSize: 11.5, fontWeight: 500, color: "#6e6e73" }}
      >
        {field.label}
        {field.required ? (
          <span style={{ color: "#ff3b30", marginLeft: 3 }}>*</span>
        ) : null}
      </label>
      {field.type === "select" && field.options?.length ? (
        <select
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={baseInputStyle}
        >
          <option value="">{field.placeholder ?? "Select…"}</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={inputId}
          type={field.type === "date" ? "date" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? `Enter ${field.label}`}
          disabled={disabled}
          inputMode={field.type === "number" ? "decimal" : undefined}
          style={baseInputStyle}
        />
      )}
    </div>
  );
}

// — Document preview ─────────────────────────────────────────────
//
// Renders an inline attachment card for any `document-preview` widget
// produced by `chat-event-reducer.collectDocumentWidgets`.
//
// Two open modes, picked per-attachment:
//   1. Rich highlight viewer (preferred). When the file is a PDF and the
//      enclosing exception has a `runId`, clicking the card raises
//      `onOpenDocumentViewer(...)` so the page mounts an
//      {@link InvoicePdfHighlightViewer} dialog with bounding-box overlays
//      and per-field confidence — same affordance as v1.
//   2. Popup-window fallback. When a `runId` is missing or the file isn't
//      a PDF, `window.open(href, …, DOC_POPUP_FEATURES)` opens a sized
//      browser popup so the user gets a dedicated viewer surface (vs. a
//      full new tab). Browser popup blocks degrade to a plain new tab.
//
// We always compute `href` from the agent-supplied URL or the
// `/api/kognitos/files/{id}` proxy — same pattern as v1.

const DOC_POPUP_FEATURES =
  "popup=yes,width=1000,height=800,resizable=yes,scrollbars=yes,toolbar=no,menubar=no";

/**
 * Infer a MIME type from a filename / label or, failing that, the file URL
 * path. Agent-supplied attachments often arrive without an explicit
 * `mimeType` and without a useful filename — but the URL still ends in
 * `.pdf`, `.png`, etc. Sniffing both keeps PDFs out of the popup-window
 * fallback when the agent only gives us a file id.
 */
function inferMimeFromName(
  name: string | null | undefined,
  url?: string | null,
): string | null {
  const sources: string[] = [];
  if (name) sources.push(name);
  if (url) {
    // Strip query / hash so `?token=...` doesn't mask `.pdf`.
    const path = url.split(/[?#]/, 1)[0];
    if (path) sources.push(path);
  }
  for (const s of sources) {
    const m = s.toLowerCase().match(/\.([a-z0-9]+)$/);
    if (!m) continue;
    switch (m[1]) {
      case "pdf":
        return "application/pdf";
      case "png":
        return "image/png";
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "gif":
        return "image/gif";
      case "webp":
        return "image/webp";
      case "svg":
        return "image/svg+xml";
      default:
        continue;
    }
  }
  return null;
}

function V2DocumentPreviewCard({
  data,
  runId,
  onOpenDocumentViewer,
}: {
  data: ChatDocumentPreviewData;
  /**
   * Exception's `runId` — when present alongside a PDF href the click
   * action launches the rich highlight viewer (PDF + bounding boxes +
   * confidence panel) instead of falling through to a popup window.
   */
  runId: string | null;
  /** Page-level handler that mounts {@link InvoicePdfHighlightViewer}. */
  onOpenDocumentViewer: (args: ChatDocumentViewerOpen) => void;
}) {
  const display = data.label || "Attached document";
  const href = data.url
    ? data.url
    : data.fileId
      ? `/api/kognitos/files/${encodeURIComponent(data.fileId)}`
      : null;
  const effectiveMime =
    data.mimeType ?? inferMimeFromName(data.label, href);
  const subtitle = effectiveMime ?? data.fileId ?? null;

  // The highlight viewer needs both a `runId` (to fetch
  // `/api/kognitos/runs/{runId}/payload` for IDP overlays) and a PDF URL.
  // Use it for PDFs only — images don't have IDP extraction.
  const isPdf = effectiveMime === "application/pdf";
  const isImage = !!effectiveMime && effectiveMime.startsWith("image/");
  const canOpenInViewer = !!href && isPdf && !!runId;
  const canOpenInImageDialog = !!href && isImage;

  const handleOpen = useCallback(() => {
    if (!href) return;
    if (canOpenInViewer && runId) {
      onOpenDocumentViewer({
        kind: "pdf",
        pdfUrl: href,
        runId,
        label: display,
      });
      return;
    }
    if (canOpenInImageDialog) {
      onOpenDocumentViewer({
        kind: "image",
        url: href,
        label: display,
        mimeType: effectiveMime,
      });
      return;
    }
    const win = window.open(href, "_blank", DOC_POPUP_FEATURES);
    if (!win) window.open(href, "_blank", "noopener,noreferrer");
  }, [
    canOpenInImageDialog,
    canOpenInViewer,
    display,
    effectiveMime,
    href,
    onOpenDocumentViewer,
    runId,
  ]);

  const openLabel = canOpenInViewer
    ? `Open ${display} in document viewer`
    : canOpenInImageDialog
      ? `Open ${display} in image preview`
      : `Open ${display} in a popup window`;

  const Inner = (
    <>
      <FileText size={13} strokeWidth={1.75} fill="none" style={{ color: "#aeaeb2" }} />
      <span
        className="min-w-0 flex-1 truncate"
        style={{
          fontSize: 12,
          color: "#1d1d1f",
          fontFamily: "var(--font-mono)",
        }}
      >
        {display}
      </span>
      {canOpenInViewer ? (
        <span
          className="inline-flex shrink-0 items-center gap-1"
          style={{ fontSize: 10, color: "#0071e3", fontWeight: 500 }}
          aria-hidden
        >
          <Maximize2 size={9} strokeWidth={2} />
          Viewer
        </span>
      ) : canOpenInImageDialog ? (
        <span
          className="inline-flex shrink-0 items-center gap-1"
          style={{ fontSize: 10, color: "#0071e3", fontWeight: 500 }}
          aria-hidden
        >
          <Maximize2 size={9} strokeWidth={2} />
          Preview
        </span>
      ) : subtitle ? (
        <span
          className="shrink-0 truncate"
          style={{ fontSize: 10, color: "#aeaeb2", maxWidth: 120 }}
        >
          {subtitle}
        </span>
      ) : null}
    </>
  );
  return (
    <div style={V2_WIDGET_CARD_STYLE} role="group" aria-label="Attached document">
      <V2WidgetLabel
        icon={<Paperclip size={13} strokeWidth={1.75} fill="none" />}
        text="Attachment"
      />
      {href ? (
        <button
          type="button"
          onClick={handleOpen}
          className="flex w-full min-w-0 items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
          style={{
            marginTop: 8,
            padding: "6px 10px",
            background: "rgba(118,118,128,0.06)",
            border: "0.5px solid rgba(0,0,0,0.08)",
            borderRadius: 8,
            cursor: "pointer",
            textAlign: "left",
          }}
          title={openLabel}
          aria-label={openLabel}
        >
          {Inner}
        </button>
      ) : (
        <div
          className="flex min-w-0 items-center gap-2"
          style={{
            marginTop: 8,
            padding: "6px 10px",
            background: "rgba(118,118,128,0.06)",
            border: "0.5px solid rgba(0,0,0,0.08)",
            borderRadius: 8,
          }}
        >
          {Inner}
        </div>
      )}
    </div>
  );
}

// — Image preview dialog ─────────────────────────────────────────
//
// Lightweight in-app modal for image attachments (PNG / JPG / GIF /
// WebP / SVG). Used by V2DocumentPreviewCard when an attachment is an
// image (no IDP highlight viewer applies). Same dark surround as the
// PDF dialog so attachment type doesn't introduce a chrome jump.
//
// SVG is rendered via <img> (not inlined) — agent attachments come
// from the Files API as opaque bytes, so there's no DOM-injection risk
// here, but we still don't want to evaluate untrusted SVG scripts.

function ChatImagePreviewDialog({
  data,
  onClose,
}: {
  data: ChatImagePreviewOpen | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={data != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        centerFlex
        showCloseButton
        className="flex h-[min(82.8vh,828px)] w-[min(88.2vw,82.8rem)] max-w-[min(88.2vw,82.8rem)] flex-col gap-0 overflow-hidden border border-white/[0.08] bg-zinc-900 p-0 text-zinc-100 shadow-xl shadow-black/20 sm:max-w-[min(88.2vw,82.8rem)] [&_[data-slot=dialog-close]]:text-zinc-400 [&_[data-slot=dialog-close]]:hover:text-zinc-100"
      >
        <DialogHeader className="shrink-0 border-b border-white/[0.07] bg-zinc-900 px-4 py-2 text-left">
          <DialogTitle className="text-base font-medium text-zinc-50">
            {data?.label ?? "Image preview"}
          </DialogTitle>
        </DialogHeader>
        {data ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#323234] p-6">
            {/*
              Image attachments come from /api/kognitos/files/[id] (proxy
              of an org-level Kognitos file). Dimensions are unknown,
              the URL isn't CDN-cacheable, and next/image's loader
              doesn't add value — a plain <img> with object-contain
              keeps full fidelity inside the modal.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.url}
              alt={data.label}
              className="block max-h-full max-w-full select-none object-contain"
              loading="eager"
              draggable={false}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
