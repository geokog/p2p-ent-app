"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Loader2,
  Mail,
  Maximize2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  RefreshCw,
  RotateCw,
  Send,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  User as UserIcon,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { InvoicePdfHighlightViewer } from "@/components/kognitos/invoice-pdf-highlight-viewer";
import {
  type ExceptionDetailBundleDto,
  type ExceptionDetailDto,
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
  type ChatTextMessage,
  type ChatThinkingMessage,
  type ChatToolCallMessage,
  type ChatSystemErrorMessage,
  type ChatSystemCompletionMessage,
  type ChatWidget,
} from "@/lib/kognitos/chat-event-reducer";
import { useExceptionStream } from "@/lib/kognitos/use-exception-stream";
import { useBuilderProgress } from "@/lib/kognitos/use-builder-progress";
import {
  buildEditFactsXmlFromRelatedOutputs,
  type EditedFact,
  type ParsedFact,
  type ParsedGuideEntry,
  type ParsedRelatedOutputs,
} from "@/lib/kognitos/astral-chat-xml";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type StateFilterParam =
  | "pending"
  | "archived"
  | "resolved"
  | "non_resolved";

const STATE_TABS: { value: StateFilterParam; label: string }[] = [
  { value: "pending", label: "Needs review" },
  { value: "resolved", label: "Resolved" },
  { value: "archived", label: "Archived" },
  { value: "non_resolved", label: "All non-resolved" },
];

const GUIDANCE_POST_REPLY_DELAY_MS = 1500;
const GUIDANCE_POLL_INTERVAL_MS = 2500;
const GUIDANCE_POLL_MAX_MS = 50_000;
/** After the first new event arrives, keep polling until this long passes with no further changes. */
const GUIDANCE_POLL_IDLE_STOP_MS = 8_000;
const PROCESSING_FEEDBACK_LABEL = "Processing Feedback";

async function fetchExceptionBundle(
  exceptionId: string,
): Promise<
  | { ok: true; data: ExceptionDetailBundleDto }
  | { ok: false; error: string }
> {
  try {
    const res = await fetch(
      `/api/kognitos/exceptions/${encodeURIComponent(exceptionId)}`,
    );
    const data = (await res.json()) as ExceptionDetailBundleDto & { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? res.statusText };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "load_failed" };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Add `seconds` (which may be negative) to an ISO-8601 timestamp string and
 * return the result as ISO-8601. Used to widen string-comparison windows
 * for optimistic-message dedup so small client/server clock skew doesn't
 * cause a fresh outgoing bubble to match (or miss matching) its server
 * echo. Returns the original string if it can't be parsed.
 */
function addSecondsIso(iso: string, seconds: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t + seconds * 1000).toISOString();
}

type GuidancePollSnapshot = {
  eventCount: number;
  latestEventTime: string | null;
  state: ExceptionStateUi;
  title: string;
  descriptionFull: string | null;
  messageFull: string;
};

function eventLatestTime(events: ExceptionEventDto[]): string | null {
  let latest: string | null = null;
  for (const e of events) {
    if (!e.createTime) continue;
    if (!latest || e.createTime > latest) latest = e.createTime;
  }
  return latest;
}

function buildPollSnapshot(bundle: ExceptionDetailBundleDto | null): GuidancePollSnapshot {
  const events = bundle?.events ?? [];
  const ex = bundle?.exception;
  return {
    eventCount: events.length,
    latestEventTime: eventLatestTime(events),
    state: ex?.state ?? "UNKNOWN",
    title: ex?.title ?? "",
    descriptionFull: ex?.descriptionFull ?? null,
    messageFull: ex?.messageFull ?? "",
  };
}

function pollSnapshotChanged(
  snap: GuidancePollSnapshot,
  data: ExceptionDetailBundleDto,
): boolean {
  const ev = data.events;
  const latest = eventLatestTime(ev);
  if (ev.length > snap.eventCount) return true;
  if (latest && snap.latestEventTime && latest > snap.latestEventTime) return true;
  if (latest && !snap.latestEventTime && ev.length > snap.eventCount) return true;
  const ex = data.exception;
  if (ex.state !== snap.state) return true;
  if (ex.title !== snap.title) return true;
  if ((ex.descriptionFull ?? "") !== (snap.descriptionFull ?? "")) return true;
  if (ex.messageFull !== snap.messageFull) return true;
  return false;
}

function summaryFromDetail(ex: ExceptionDetailDto): ExceptionSummaryDto {
  return {
    exceptionId: ex.exceptionId,
    state: ex.state,
    groupLabel: ex.groupLabel,
    title: ex.title,
    automationId: ex.automationId,
    automationDisplayName: ex.automationDisplayName,
    runId: ex.runId,
    createTime: ex.createTime,
    assigneeShort: ex.assigneeShort,
    executionId: ex.executionId,
  };
}

function statePillClass(s: ExceptionStateUi): string {
  if (s === "PENDING")
    return "border-app-amber/25 bg-app-amber-bg text-app-amber-text border";
  if (s === "ARCHIVED")
    return "border-app-border bg-app-slate-bg text-app-text-muted border";
  if (s === "RESOLVED")
    return "border-app-green-border/60 bg-app-green-bg text-[color:var(--app-green)] border";
  return "border-app-border bg-app-slate-bg text-app-text-secondary border";
}

function stateDotClass(s: ExceptionStateUi): string {
  if (s === "PENDING") return "bg-[#F59E0B]";
  if (s === "RESOLVED") return "bg-app-green";
  if (s === "ARCHIVED") return "bg-app-slate";
  return "bg-navy-700/40";
}

function stateVisibleLabel(s: ExceptionStateUi): string {
  if (s === "PENDING") return "Needs review";
  if (s === "RESOLVED") return "Resolved";
  if (s === "ARCHIVED") return "Archived";
  return "Unknown";
}

function processingFeedbackPillClass(): string {
  return statePillClass("RESOLVED");
}

function processingFeedbackDotClass(): string {
  return stateDotClass("RESOLVED");
}

function looksLikeOpaqueId(s: string): boolean {
  const t = s.trim();
  if (t.length < 16) return false;
  return /^[A-Za-z0-9_-]+$/.test(t);
}

function isFriendlyAutomationDisplayName(
  displayName: string | null | undefined,
  automationId: string,
): boolean {
  if (!displayName?.trim()) return false;
  const d = displayName.trim();
  if (d === automationId.trim()) return false;
  if (looksLikeOpaqueId(d)) return false;
  return true;
}

type ConciseTitleInput = {
  title: string;
  descriptionFull?: string | null;
  groupLabel?: string;
};

function clipTitleAtWord(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.45 ? lastSpace : max;
  return `${t.slice(0, cut).trim()}…`;
}

/** Presentation-only short title for list and inspector (does not change API data). */
function exceptionConciseTitle(input: ConciseTitleInput): string {
  const title = input.title.trim();
  const hay = `${title}\n${input.descriptionFull ?? ""}\n${input.groupLabel ?? ""}`.toLowerCase();

  if (
    (/invoice\s*pdf|\bpdf\b/i.test(hay) && /purchase\s*order|\bpo\b|p\.o\./i.test(hay)) ||
    /missing\s+po\s+number\s+in/i.test(hay)
  ) {
    return "Missing PO number in invoice PDF";
  }
  if (/unable\s+to\s+create\s+invoice\s+line|invoice\s+line\s+items?/i.test(hay)) {
    return "Unable to create invoice line items";
  }
  if (/unable\s+to\s+process\s+(the\s+)?purchase\s*order|process\s+(the\s+)?purchase\s*order/i.test(hay)) {
    return "Unable to process purchase order";
  }
  if (/purchase\s*order\s+item\s+data|item\s+data.*purchase\s*order|missing.*item\s+data/i.test(hay)) {
    return "Missing purchase order item data";
  }
  if (
    /missing\s+(the\s+)?purchase\s*order\s+number|missing\s+po\s+number\b|purchase\s*order\s+number\s+is\s+missing|no\s+purchase\s*order\s+number\b/i.test(
      hay,
    ) &&
    !/purchase\s*order\s+items?/i.test(hay)
  ) {
    return "Missing purchase order number";
  }
  if (
    /purchase\s*order|p\.o\.|\bpo\b/i.test(hay) &&
    /supplier\s*invoice|unable to build|invoice cannot|no purchase order|purchase order items|line items|were not found|not found/i.test(
      hay,
    )
  ) {
    return "Missing purchase order items";
  }

  const runOn =
    title.length > 56 ||
    /^unable to .{25,}/i.test(title) ||
    (title.includes(" because ") && title.length > 48);

  if (!runOn && title.length > 0) return title;

  const beforeBecause = title.match(/^(unable to [^\n]+?)(?=\s+because\b)/i);
  if (beforeBecause?.[1]) {
    const seg = beforeBecause[1].trim();
    if (seg.length >= 14 && seg.length <= 58) return seg;
    if (seg.length > 58) return clipTitleAtWord(seg, 56);
    if (seg.length >= 10) return seg;
  }

  if (title.length > 56) return clipTitleAtWord(title, 56);
  return title || "Exception";
}

function sentenceTooCloseToConcise(s: string, concise: string): boolean {
  const a = s.toLowerCase().replace(/\s+/g, " ").trim();
  const b = concise.toLowerCase().replace(/\s+/g, " ").trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const pref = b.slice(0, Math.min(36, b.length));
  if (pref.length > 10 && a.startsWith(pref.slice(0, Math.min(20, pref.length)))) return true;
  if (pref.length > 10 && b.startsWith(a.slice(0, Math.min(24, a.length)))) return true;
  return false;
}

function cardLeadingIcon(row: ExceptionSummaryDto) {
  const g = row.groupLabel.toLowerCase();
  if (g.includes("mail") || g.includes("email")) return Mail;
  return FileText;
}

function filterSummaries(
  list: ExceptionSummaryDto[],
  query: string,
): ExceptionSummaryDto[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((row) => {
    const hay = [
      row.title,
      row.groupLabel,
      row.automationId,
      row.automationDisplayName ?? "",
      row.exceptionId,
    ]
      .join("\n")
      .toLowerCase();
    return hay.includes(q);
  });
}

function firstParagraph(text: string): string {
  const t = text.trim();
  if (!t) return "";
  const para = t.split(/\n\s*\n/)[0] ?? t;
  return para.split("\n")[0]?.trim() ?? t;
}

function sentencesFromParagraph(p: string): string[] {
  return p
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function headerBusinessImpact(ex: ExceptionDetailDto): string {
  const concise = exceptionConciseTitle({
    title: ex.title,
    descriptionFull: ex.descriptionFull,
    groupLabel: ex.groupLabel,
  });
  const raw = ex.descriptionFull?.trim();
  if (!raw) {
    return "Resolve this issue so the automation can continue processing related work.";
  }
  const p1 = firstParagraph(raw);
  const sents = sentencesFromParagraph(p1);

  const score = (s: string) => {
    let sc = 0;
    if (/because|cannot|unable to|missing|failed to|no \w+ found|without a\b/i.test(s)) sc += 3;
    if (/\b(invoice|supplier|customer|payment|order|po)\b/i.test(s)) sc += 1;
    return sc;
  };

  const candidates = [...sents].sort((a, b) => score(b) - score(a));
  for (const s of candidates) {
    if (sentenceTooCloseToConcise(s, concise)) continue;
    return s.length > 280 ? `${s.slice(0, 280)}…` : s;
  }
  for (const s of sents) {
    if (!sentenceTooCloseToConcise(s, concise)) {
      return s.length > 240 ? `${s.slice(0, 240)}…` : s;
    }
  }
  if (p1.toLowerCase() !== concise.toLowerCase() && !sentenceTooCloseToConcise(p1, concise)) {
    return p1.length > 240 ? `${p1.slice(0, 240)}…` : p1;
  }
  return "Resolve this issue so the automation can continue processing related work.";
}

function whatHappenedOperational(ex: ExceptionDetailDto): string {
  const raw = ex.descriptionFull?.trim();
  if (!raw) {
    return "No operational narrative was stored for this exception beyond the summary above.";
  }
  const concise = exceptionConciseTitle({
    title: ex.title,
    descriptionFull: ex.descriptionFull,
    groupLabel: ex.groupLabel,
  });
  const impact = headerBusinessImpact(ex).replace(/…$/, "").trim();
  const hay = `${raw} ${ex.title}`.toLowerCase();
  const poFamilyTitles = new Set([
    "Missing purchase order items",
    "Missing purchase order number",
    "Missing purchase order item data",
    "Missing PO number in invoice PDF",
    "Unable to create invoice line items",
    "Unable to process purchase order",
  ]);
  const poCtx =
    poFamilyTitles.has(concise) ||
    (/purchase\s*order|\bpo\b|p\.o\./i.test(hay) &&
      /supplier\s*invoice|unable to build|invoice|line items/i.test(hay));

  function overlapsLayer(s: string): boolean {
    const t = s.trim();
    if (!t) return true;
    if (sentenceTooCloseToConcise(t, concise)) return true;
    if (impact.length > 16) {
      const ip = impact.slice(0, Math.min(56, impact.length)).toLowerCase();
      if (t.toLowerCase().includes(ip)) return true;
    }
    return false;
  }

  const paras = raw.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  if (paras.length >= 2) {
    const body = paras.slice(1).join("\n\n");
    if (!overlapsLayer(body)) {
      return body.length > 900 ? `${body.slice(0, 900)}…` : body;
    }
  }
  const p1 = paras[0] ?? raw;
  const sents = sentencesFromParagraph(p1);
  const rest = sents.filter((s) => !overlapsLayer(s));
  if (rest.length) {
    const out = rest.join(" ");
    return out.length > 900 ? `${out.slice(0, 900)}…` : out;
  }
  if (poCtx) {
    if (concise === "Missing purchase order number" || concise === "Missing PO number in invoice PDF") {
      return "The automation could not proceed because a valid purchase order number was not available in the inputs for this step.";
    }
    if (concise === "Unable to create invoice line items") {
      return "The automation could not derive invoice line rows from the current purchase order and invoice inputs.";
    }
    if (concise === "Unable to process purchase order") {
      return "The automation halted while processing the purchase order with the data and rules currently in scope.";
    }
    if (concise === "Missing purchase order item data") {
      return "Required purchase order item fields were missing or incomplete, so the step could not continue.";
    }
    if (concise === "Missing purchase order items") {
      return "The automation stopped at this step because the required purchase order line items were not available in scope.";
    }
    return "The automation stopped at this step because purchase-order-related inputs did not satisfy the rules for this step.";
  }
  return "The automation stopped at this step based on the rules and inputs in scope. Adjust the data or guidance, then retry once corrected.";
}

/** Prescriptive next step — does not repeat the raw error paragraph. */
function recommendedActionCopy(ex: {
  title: string;
  descriptionFull?: string | null;
}): string {
  const desc = (ex.descriptionFull ?? "").toLowerCase();
  const title = ex.title.toLowerCase();
  const hay = `${desc} ${title}`;
  if (/purchase\s*order|\bpo\b|p\.o\./i.test(hay)) {
    return "Provide the correct purchase order number, or confirm that this invoice should be processed without a PO. Once provided, the agent can continue.";
  }
  if (/missing|required field|invalid.?value|not found|unknown recipient/i.test(hay)) {
    return "Identify the missing or invalid field, correct it in source data or confirm the intended value, then tell the agent exactly what to use so the step can be retried safely.";
  }
  if (/timeout|timed out|unavailable|503|502|connection/i.test(hay)) {
    return "Confirm whether the failure was transient. If so, retry after a short wait; if not, specify an alternate path or data source so the agent can continue without repeating the same failure.";
  }
  return "State the concrete correction or decision the agent should apply, then send guidance so the resolution agent can continue without guessing.";
}

function neutralMetaPillClass() {
  return cn(
    "max-w-full truncate rounded-[10px] border border-app-border bg-app-slate-bg px-2 py-0.5",
    "text-app-text-secondary text-[12px] font-normal leading-tight",
  );
}

function byteLocationFromDisplay(display: string): string | null {
  const t = display.trim();
  if (!t || t === "—") return null;
  return /^bytes\s/i.test(t) ? t : null;
}

function rawLocationForTechnical(display: string): string | null {
  const t = display.trim();
  if (!t || t === "—") return null;
  return /^bytes\s/i.test(t) ? null : t;
}

function tracebackFromExtra(extra: Record<string, string>): string | null {
  const hits: string[] = [];
  for (const [k, v] of Object.entries(extra)) {
    const kl = k.toLowerCase();
    if (/trace|stack|tb|error|exception|cause|detail/i.test(kl)) {
      hits.push(`${k}\n${v}`);
    }
  }
  if (hits.length) return hits.join("\n\n");
  return null;
}

/** Number of older messages to keep collapsed inside the "earlier messages" expander. */
const HISTORY_RECENT_COUNT = 6;

/** Synthetic id prefix for optimistic outgoing user messages. */
const OPTIMISTIC_USER_PREFIX = "optimistic:user:";

/** Empty-state suggestions shown when there is no chat yet. */
const STARTER_PROMPTS: { label: string; payload: string }[] = [
  {
    label: "Retry the failed step",
    payload:
      "Please retry this step and let me know what you observe. If the same input still fails, suggest the smallest change I can make to unblock it.",
  },
  {
    label: "Show the IDP output",
    payload:
      "Show me the IDP-extracted fields you have for this document so I can confirm or correct them.",
  },
];

function newOptimisticId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${OPTIMISTIC_USER_PREFIX}${crypto.randomUUID()}`;
  }
  return `${OPTIMISTIC_USER_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    /* ignore */
  }
}

function TechField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  if (!value.trim()) return null;
  const showCopy = value.trim() !== "—";
  return (
    <div className="min-w-0">
      <div className="text-app-text-secondary flex flex-wrap items-center justify-between gap-2 font-sans text-[12px] font-medium">
        <span>{label}</span>
        {showCopy ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-app-text-muted h-7 px-2 text-[11px]"
            onClick={() => void copyToClipboard(value)}
          >
            <Copy className="mr-1 size-3" aria-hidden />
            Copy
          </Button>
        ) : null}
      </div>
      <p
        className={cn(
          "text-app-text-primary mt-1 min-w-0 break-all leading-relaxed",
          mono && "font-mono text-[12px]",
        )}
      >
        {value}
      </p>
    </div>
  );
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
    <section className="min-w-0 px-6 py-4" aria-labelledby={sectionId}>
      <h2
        id={sectionId}
        className="text-app-text-primary mb-2 text-sm font-semibold tracking-tight"
      >
        {title}
      </h2>
      <div className="min-w-0 space-y-2 text-[13px] leading-relaxed">{children}</div>
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
  /** True on first paint and after changing status tab — next full list load selects the first row. */
  const pendingSelectFirstRef = useRef(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [, setDetailSilentRefreshing] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ExceptionDetailBundleDto | null>(null);
  const bundleRef = useRef<ExceptionDetailBundleDto | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const guidancePollRunIdRef = useRef(0);
  const [guidanceProcessingIds, setGuidanceProcessingIds] = useState(
    () => new Set<string>(),
  );
  const [guidancePollTimeoutNotice, setGuidancePollTimeoutNotice] = useState<
    string | null
  >(null);

  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const lastSentMessageRef = useRef<string>("");

  const [streamMessages, setStreamMessages] = useState<ChatMessageDto[]>([]);
  /** Outgoing user messages we have rendered optimistically while waiting for stream/poll. */
  const [optimisticMessages, setOptimisticMessages] = useState<ChatTextMessage[]>([]);
  const [lastEventAt, setLastEventAt] = useState<number>(() => Date.now());
  const lastSeenServerEventIdsRef = useRef<Set<string>>(new Set());
  const cancelBusyRef = useRef(false);

  /**
   * Document-viewer dialog state. When set, mounts the same
   * `InvoicePdfHighlightViewer` the dashboard's runs-analyzed table uses,
   * giving us PDF + bounding-box overlays + per-field confidence panel for
   * any file the agent surfaces inline in the chat.
   */
  const [documentViewer, setDocumentViewer] = useState<{
    pdfUrl: string;
    runId: string;
    label: string;
  } | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const filteredItems = useMemo(
    () => filterSummaries(items, deferredSearch),
    [items, deferredSearch],
  );

  const baseMessages = useMemo(
    () => (bundle?.events ? messagesFromEvents(bundle.events) : []),
    [bundle?.events],
  );

  /**
   * Authoritative message list: start from the server snapshot, layer in any
   * stream events the snapshot has not caught up to yet, and finally any
   * optimistic outgoing user messages that have not been echoed back as
   * server-side `user` events.
   *
   * Stream-vs-snapshot horizon: Kognitos's `/events:list` returns at most
   * `page_size` events (capped at 50 in `/api/kognitos/exceptions/[id]`),
   * but the streaming endpoint replays the FULL conversation history on
   * every connect. Once a thread exceeds 50 events the replayed historical
   * tail is no longer part of the snapshot, and naively appending it to
   * `baseMessages` puts ancient events at the BOTTOM of the chat — which
   * then anchors `visibleRows` on an old user message and pushes the live
   * turn into the collapsed "earlier messages" section. We only blamed
   * symptoms ("my message disappears when the first mcp_astral_display
   * arrives"; hard refresh fixes it because it wipes `streamMessages`).
   *
   * Fix: treat `baseMessages` as the canonical record up to its newest
   * createTime, and only let `streamMessages` contribute events strictly
   * newer than that horizon (i.e. live events the next poll will pick up).
   */
  const messages = useMemo<ChatMessageDto[]>(() => {
    const baseIds = new Set(baseMessages.map((m) => m.id));
    let baseMaxTime = "";
    for (const m of baseMessages) {
      if (m.createTime && m.createTime > baseMaxTime) baseMaxTime = m.createTime;
    }
    const merged: ChatMessageDto[] = [...baseMessages];
    for (const m of streamMessages) {
      if (baseIds.has(m.id)) continue;
      // Drop replayed historical events that already lived earlier than
      // anything in the snapshot — those are the rotated-out tail Kognitos
      // re-emits on every stream connect.
      if (
        baseMaxTime &&
        m.createTime &&
        m.createTime <= baseMaxTime
      ) {
        continue;
      }
      const idx = merged.findIndex((x) => x.id === m.id);
      if (idx >= 0) merged[idx] = m;
      else merged.push(m);
    }
    // Dedup optimistic user bubbles against everything we've already merged
    // (snapshot + stream). Without checking streamMessages too, the user
    // briefly sees their message twice in the gap between the stream echo
    // (~1s) and the polling sync (~3-5s) — and then watches one copy
    // "disappear" when the optimistic finally gets cleared. Checking the
    // merged set closes that visual race entirely.
    //
    // Time-scoped dedup: only suppress an optimistic bubble when there's a
    // matching server-side user message at-or-after the optimistic's own
    // createTime. Without that scope, sending the same content the user
    // already sent earlier (e.g. "hello" twice) would dedup the new
    // optimistic against the OLD echo and the new bubble would visually
    // vanish until the new server echo arrives.
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
      // Allow ~5s of clock skew between client and server before we
      // trust a same-content match as "this is my echo".
      if (newest !== undefined && newest >= addSecondsIso(optTime, -5)) {
        continue;
      }
      merged.push(m);
    }
    return merged;
  }, [baseMessages, streamMessages, optimisticMessages]);

  /**
   * Live ref to the merged message list. Used by `useExceptionStream`'s
   * `isClosable` predicate so the auto-close machine can read the latest
   * state without re-binding (the predicate must be cheap to call from
   * inside a setTimeout that may fire several times during a grace window).
   */
  const messagesRef = useRef<ChatMessageDto[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /**
   * Returns true when no client-side work remains — i.e. it's safe for the
   * stream to auto-close after the post-completion grace window. We block
   * close when:
   *   - any message is still `isStreaming` (partial agent_message / thinking
   *     snapshot waiting on its `STATE_COMPLETE` follow-up); or
   *   - any tool-call message has no matching result yet (waiting on a late
   *     `tool_call_result` to pair via `applyMessageUpdate`).
   */
  const isStreamClosable = useCallback(() => {
    const ms = messagesRef.current;
    for (const m of ms) {
      if (m.isStreaming) return false;
      if (m.kind === "tool-call" && m.result === undefined) return false;
    }
    return true;
  }, []);

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
          setSelectedId(null);
          pendingSelectFirstRef.current = false;
          return;
        }
        const next = data.items ?? [];
        if (opts?.append) {
          setItems((prev) => [...prev, ...next]);
        } else {
          setItems(next);
          if (next.length === 0) {
            setSelectedId(null);
            pendingSelectFirstRef.current = false;
          } else if (pendingSelectFirstRef.current) {
            setSelectedId(next[0].exceptionId);
            pendingSelectFirstRef.current = false;
          } else {
            setSelectedId((cur) => {
              if (!cur) return cur;
              return next.some((r) => r.exceptionId === cur)
                ? cur
                : next[0].exceptionId;
            });
          }
        }
        setNextPageToken(data.nextPageToken ?? null);
      } catch (e) {
        setListError(e instanceof Error ? e.message : "load_failed");
        setItems([]);
        setNextPageToken(null);
        setSelectedId(null);
        pendingSelectFirstRef.current = false;
      } finally {
        setListLoading(false);
      }
    },
    [stateFilter],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    bundleRef.current = bundle;
  }, [bundle]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadDetail = useCallback(
    async (
      id: string,
      options?: { silent?: boolean },
    ): Promise<ExceptionDetailBundleDto | null> => {
      const silent = Boolean(options?.silent);
      if (silent) {
        setDetailSilentRefreshing(true);
      } else {
        setDetailLoading(true);
        setDetailError(null);
        setReplyText("");
        setReplyError(null);
      }
      try {
        const result = await fetchExceptionBundle(id);
        if (!result.ok) {
          if (!silent) {
            setBundle(null);
            setDetailError(result.error);
          }
          return null;
        }
        if (!silent || selectedIdRef.current === id) {
          setBundle(result.data);
        }
        if (silent) {
          setItems((prev) =>
            prev.map((row) =>
              row.exceptionId === id
                ? { ...row, ...summaryFromDetail(result.data.exception) }
                : row,
            ),
          );
        }
        return result.data;
      } catch (e) {
        if (!silent) {
          setBundle(null);
          setDetailError(e instanceof Error ? e.message : "load_failed");
        }
        return null;
      } finally {
        if (silent) setDetailSilentRefreshing(false);
        else setDetailLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    guidancePollRunIdRef.current += 1;
    setStreamMessages([]);
    setOptimisticMessages([]);
    lastSeenServerEventIdsRef.current = new Set();
    setLastEventAt(Date.now());
    if (selectedId) void loadDetail(selectedId);
    else setBundle(null);
    return () => {
      guidancePollRunIdRef.current += 1;
    };
  }, [selectedId, loadDetail]);

  useEffect(() => {
    setGuidancePollTimeoutNotice(null);
  }, [selectedId]);

  // When the server snapshot updates, drop any optimistic user message that
  // matches a real server-side `user` event (by content AND timestamp), and
  // drop any stream messages that have been folded into the snapshot.
  //
  // The timestamp scope is critical when the user repeats the same content
  // (e.g. "hello" twice). Without it, the new optimistic gets dedup'd
  // against the OLDER server echo of the previous "hello" and the bubble
  // visually vanishes until the new server echo arrives.
  useEffect(() => {
    if (!bundle?.events) return;
    const ids = new Set(bundle.events.map((e) => e.id));
    lastSeenServerEventIdsRef.current = ids;
    setStreamMessages((prev) => prev.filter((m) => !ids.has(m.id)));
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
        // Allow ~5s of skew between client and server clocks before we
        // accept a same-content event as "this is my echo".
        return newest < addSecondsIso(optTime, -5);
      }),
    );
  }, [bundle?.events]);

  const handleStreamEvents = useCallback((events: ExceptionEventDto[]) => {
    if (events.length === 0) return;
    setLastEventAt(Date.now());
    setStreamMessages((prev) => {
      let next = prev;
      for (const e of events) {
        next = applyMessageUpdate(next, e);
      }
      return next;
    });
  }, []);

  const handleStreamFallback = useCallback((reason: string) => {
    setGuidancePollTimeoutNotice(
      `Live updates unavailable (${reason}). Falling back to polling.`,
    );
  }, []);

  const stream = useExceptionStream({
    onEvents: handleStreamEvents,
    onFallback: handleStreamFallback,
    // Kognitos `StreamEvents` doesn't close per agent turn; opt in to the
    // hook's auto-close machine so we free the upstream socket once a
    // STATE_COMPLETE completion arrives and trailing events have settled.
    closeOnCompletion: true,
    isClosable: isStreamClosable,
  });

  /**
   * "Agent is doing work" model.
   *
   * Note: we deliberately do NOT use `stream.status === "open"` as a signal
   * here. Kognitos `StreamEvents` keeps its HTTP body open for the entire
   * chat session (not per-turn), so an "open" stream tells us nothing about
   * whether the agent is currently active. Using it would leave the typing
   * indicator stuck after each reply until the user refreshed.
   *
   * The two signals below cover both bookends correctly:
   *   1. `guidanceProcessingIds` — set when we POST a reply and cleared when
   *      the post-send polling settles (idle for `GUIDANCE_POLL_IDLE_STOP_MS`
   *      or after `GUIDANCE_POLL_MAX_MS`). Covers the gap between Send and
   *      the first stream event.
   *   2. A `thinking` or `tool-call` message in `STATE_STREAMING`. Covers
   *      the agent's active generation window; flips to false when each
   *      streaming event reaches `STATE_COMPLETE` (or when the matching
   *      `tool_call_result` arrives).
   */
  const isAgentWorking = useMemo(() => {
    if (selectedId && guidanceProcessingIds.has(selectedId)) return true;
    return messages.some(
      (m) => m.isStreaming && (m.kind === "thinking" || m.kind === "tool-call"),
    );
  }, [selectedId, guidanceProcessingIds, messages]);

  const builderProgress = useBuilderProgress({
    isActive: isAgentWorking,
    lastEventAt,
  });

  /**
   * Send a chat message to the resolution agent.
   * Used by both the free-form reply textarea and interactive widgets
   * (e.g. the editable `<related_outputs>` card sending `<user_action>` XML).
   *
   * Flow:
   *   1. Push an optimistic user bubble with `status="sending"` so the user
   *      sees feedback immediately (mirrors `useRunChat.tsx` lines 1643–1656).
   *   2. POST `/reply`. On success, mark the optimistic bubble `sent`.
   *   3. Open the NDJSON stream so the agent's response renders live.
   *   4. Keep the polling fallback as a safety net for stream failures.
   */
  async function sendReplyMessage(
    rawContent: string,
    opts?: { clearReplyText?: boolean },
  ): Promise<boolean> {
    if (!selectedId) return false;
    const content = rawContent.trim();
    if (!content) return false;
    setReplyBusy(true);
    setReplyError(null);
    lastSentMessageRef.current = content;

    const optimistic = makeOptimisticUserMessage(content);
    setOptimisticMessages((prev) => [...prev, optimistic]);
    setLastEventAt(Date.now());

    try {
      const res = await fetch(
        `/api/kognitos/exceptions/${encodeURIComponent(selectedId)}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: content }),
        },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        hint?: string;
      };
      if (!res.ok) {
        const base = data.error ?? res.statusText;
        setReplyError(data.hint ? `${base}\n\n${data.hint}` : base);
        setOptimisticMessages((prev) =>
          prev.map((m) => (m.id === optimistic.id ? { ...m, status: "failed" } : m)),
        );
        return false;
      }
      if (opts?.clearReplyText) setReplyText("");
      setOptimisticMessages((prev) =>
        prev.map((m) => (m.id === optimistic.id ? { ...m, status: "sent" } : m)),
      );
      // Open the live NDJSON stream so the agent's reply renders incrementally.
      // Seed the stream with the event ids we already know about so the
      // history-replay Kognitos bursts on connect doesn't trip the
      // close-on-completion machine. We feed both the snapshot bundle (canonical
      // server view) and any live stream messages we've accumulated since (in
      // case polling hasn't caught up to the most recent agent activity yet).
      stream.start(selectedId, {
        seedEventIds: [
          ...(bundleRef.current?.events ?? []).map((e) => e.id),
          ...streamMessages.map((m) => m.id),
        ],
      });
      const pollExceptionId = selectedId;
      setGuidancePollTimeoutNotice(null);
      setGuidanceProcessingIds((prev) => new Set([...prev, pollExceptionId]));
      const myRun = ++guidancePollRunIdRef.current;

      void (async () => {
        let changed = false;
        let latestSnap = buildPollSnapshot(bundleRef.current);
        let lastChangeAt = 0;
        try {
          await sleep(GUIDANCE_POST_REPLY_DELAY_MS);
          const deadline = Date.now() + GUIDANCE_POLL_MAX_MS;
          while (Date.now() < deadline) {
            if (guidancePollRunIdRef.current !== myRun) return;
            const fresh = await loadDetail(pollExceptionId, { silent: true });
            if (guidancePollRunIdRef.current !== myRun) return;
            if (fresh && pollSnapshotChanged(latestSnap, fresh)) {
              changed = true;
              lastChangeAt = Date.now();
              latestSnap = buildPollSnapshot(fresh);
            } else if (
              changed &&
              lastChangeAt > 0 &&
              Date.now() - lastChangeAt > GUIDANCE_POLL_IDLE_STOP_MS
            ) {
              break;
            }
            await sleep(GUIDANCE_POLL_INTERVAL_MS);
          }
          if (guidancePollRunIdRef.current !== myRun) return;
          if (!changed) {
            setGuidancePollTimeoutNotice(
              "Updates are taking longer than expected. Use Refresh or check back shortly.",
            );
          }
        } finally {
          setGuidanceProcessingIds((prev) => {
            const n = new Set(prev);
            n.delete(pollExceptionId);
            return n;
          });
          if (guidancePollRunIdRef.current === myRun) {
            await loadList();
          }
        }
      })();
      return true;
    } catch (e) {
      setReplyError(e instanceof Error ? e.message : "reply_failed");
      setOptimisticMessages((prev) =>
        prev.map((m) => (m.id === optimistic.id ? { ...m, status: "failed" } : m)),
      );
      return false;
    } finally {
      setReplyBusy(false);
    }
  }

  async function submitReply() {
    await sendReplyMessage(replyText, { clearReplyText: true });
  }

  /** Resend the most recent failed user message (per-bubble retry button). */
  async function retryOptimistic(id: string) {
    const target = optimisticMessages.find((m) => m.id === id);
    if (!target) return;
    setOptimisticMessages((prev) => prev.filter((m) => m.id !== id));
    await sendReplyMessage(target.content, { clearReplyText: false });
  }

  /** Stop the in-flight stream + cancel agent generation server-side. */
  async function stopGeneration() {
    if (!selectedId || cancelBusyRef.current) return;
    cancelBusyRef.current = true;
    stream.stop();
    try {
      await fetch(
        `/api/kognitos/exceptions/${encodeURIComponent(selectedId)}/cancel`,
        { method: "POST" },
      );
    } catch {
      /* best-effort cancel; UI already reflects stopped state */
    } finally {
      cancelBusyRef.current = false;
      setGuidanceProcessingIds((prev) => {
        if (!prev.has(selectedId)) return prev;
        const n = new Set(prev);
        n.delete(selectedId);
        return n;
      });
    }
  }

  /** Re-issue the most recent user message (used by message hover action). */
  async function regenerateLastUserMessage() {
    const last = lastSentMessageRef.current.trim();
    if (!last) return;
    await sendReplyMessage(last, { clearReplyText: false });
  }

  async function submitFeedback(
    messageId: string,
    rating: "thumbs_up" | "thumbs_down",
  ) {
    if (!selectedId) return;
    try {
      await fetch(
        `/api/kognitos/exceptions/${encodeURIComponent(selectedId)}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `<user_feedback rating="${rating}" event="${messageId}" />`,
          }),
        },
      );
    } catch {
      /* feedback is best-effort */
    }
  }

  async function copyExceptionId(id: string) {
    await copyToClipboard(id);
  }

  return (
    <div className="flex min-h-[calc(100vh-6rem)] min-w-0 flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-5">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="min-w-0">
          <h1 className="text-app-text-primary text-[1.625rem] font-semibold leading-tight tracking-tight">
            Exceptions
          </h1>
          <p className="text-app-text-secondary mt-1.5 max-w-2xl text-sm leading-relaxed">
            Triage workspace exceptions from Kognitos. Pick an item to review context and
            send guidance to the resolution agent.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Exception status"
          className="border-app-border bg-app-surface flex w-full min-w-0 flex-wrap gap-1 rounded-[12px] border p-1 shadow-[var(--app-card-shadow)]"
        >
          {STATE_TABS.map((t) => {
            const active = stateFilter === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={active}
                className={cn(
                  "rounded-[10px] px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-navy-900 text-white shadow-sm"
                    : "border-app-border text-app-text-secondary hover:bg-app-surface-muted border bg-app-surface",
                )}
                onClick={() => {
                  pendingSelectFirstRef.current = true;
                  setStateFilter(t.value);
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search exceptions by title, group, automation, or id..."
            className="border-app-border bg-app-surface text-app-text-primary h-10 min-w-[12rem] flex-1 rounded-[11px] border text-sm placeholder:text-app-text-muted"
            aria-label="Search exceptions"
          />
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-app-border bg-app-surface text-app-text-secondary h-10 shrink-0 rounded-[11px]"
              >
                <Filter className="size-3.5" />
                <span className="ml-1.5">Filters</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 text-sm" align="end">
              <p className="text-app-text-secondary text-xs leading-relaxed">
                Automation filters will appear here. For now, use search and the status
                segments above.
              </p>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-app-border bg-app-surface text-app-text-secondary h-10 shrink-0 rounded-[11px]"
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

        {listError ? (
          <p className="text-destructive text-sm">{listError}</p>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-transparent">
          <ScrollArea className="min-h-[12rem] max-h-[min(52vh,28rem)] lg:max-h-[calc(100vh-14rem)]">
            <div className="flex flex-col gap-2 pr-2 pb-1">
              {listLoading && items.length === 0 ? (
                <div className="text-app-text-secondary flex flex-col items-center justify-center gap-2 py-10 text-sm">
                  <Loader2 className="size-5 animate-spin" />
                  Loading…
                </div>
              ) : null}
              {!listLoading && filteredItems.length === 0 ? (
                <p className="text-app-text-secondary py-8 text-center text-sm">
                  {items.length === 0
                    ? "No exceptions for this filter."
                    : "No exceptions match your search."}
                </p>
              ) : null}
              {filteredItems.map((row) => {
                const selected = row.exceptionId === selectedId;
                const processingGuidance = guidanceProcessingIds.has(
                  row.exceptionId,
                );
                const Icon = cardLeadingIcon(row);
                const listTitle = exceptionConciseTitle({
                  title: row.title,
                  groupLabel: row.groupLabel,
                });
                return (
                  <button
                    key={row.exceptionId}
                    type="button"
                    tabIndex={0}
                    data-state={selected ? "selected" : undefined}
                    aria-pressed={selected}
                    className={cn(
                      "border-app-border text-app-text-primary text-left transition-shadow transition-colors",
                      "focus-visible:ring-navy-700/30 flex w-full min-w-0 cursor-pointer rounded-[14px] border bg-app-surface shadow-[var(--app-card-shadow)]",
                      "focus-visible:ring-[3px] focus-visible:outline-none",
                      "hover:border-app-border-strong",
                      "border-l-[4px] border-l-transparent",
                      selected &&
                        "border-navy-selected-border bg-navy-selected-bg border-l-navy-700 shadow-[var(--app-card-shadow)]",
                    )}
                    onClick={() => setSelectedId(row.exceptionId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(row.exceptionId);
                      }
                    }}
                  >
                    <div className="flex min-w-0 gap-3 px-5 py-3.5">
                      <div
                        className="bg-app-surface-muted text-app-text-muted flex size-9 shrink-0 items-center justify-center rounded-[10px]"
                        aria-hidden
                      >
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <span
                            className={cn(
                              "text-app-text-primary line-clamp-2 text-sm font-semibold leading-snug",
                              selected && "text-navy-900",
                            )}
                            title={row.title}
                          >
                            {listTitle}
                          </span>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <span
                              className="text-app-text-muted whitespace-nowrap text-[12px] tabular-nums"
                              title={row.createTime ?? undefined}
                            >
                              {row.createTime
                                ? formatDistanceToNow(new Date(row.createTime), {
                                    addSuffix: true,
                                  })
                                : "—"}
                            </span>
                            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium leading-none text-slate-600">
                              <span
                                className={cn(
                                  "size-2 shrink-0 rounded-full",
                                  processingGuidance
                                    ? processingFeedbackDotClass()
                                    : stateDotClass(row.state),
                                )}
                                aria-hidden
                              />
                              {processingGuidance
                                ? PROCESSING_FEEDBACK_LABEL
                                : stateVisibleLabel(row.state)}
                            </span>
                          </div>
                        </div>
                        <div
                          className="mt-3 flex min-w-0 items-center gap-2.5 rounded-[10px] border border-[color:color-mix(in_srgb,var(--app-green-border)_55%,var(--app-border))] bg-app-green-bg/90 px-3 py-2"
                          aria-label="Recommended action"
                        >
                          <CheckCircle2
                            className="text-app-green size-4 shrink-0 self-start"
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-app-text-secondary text-[11px] font-medium uppercase tracking-wide">
                              Recommended action
                            </p>
                            <div
                              className={cn(
                                "grid transition-[grid-template-rows] duration-200 ease-out",
                                selected ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                              )}
                              aria-hidden={!selected}
                            >
                              <div className="min-w-0 overflow-hidden">
                                <p className="text-app-text-primary mt-0.5 min-w-0 text-[12px] leading-relaxed [overflow-wrap:anywhere]">
                                  {recommendedActionCopy(
                                    bundle &&
                                      bundle.exception.exceptionId ===
                                        row.exceptionId
                                      ? bundle.exception
                                      : row,
                                  )}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
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

      <aside
        className={cn(
          "border-app-border bg-app-surface flex min-h-[20rem] w-full max-w-full min-w-0 flex-col overflow-hidden rounded-[16px] border shadow-[var(--app-card-shadow)]",
          "lg:sticky lg:top-20 lg:max-h-[calc(100vh-8rem)] lg:w-[28rem] lg:max-w-[min(32rem,40vw)] lg:shrink-0",
        )}
      >
        {bundle ? (
          <div className="border-app-border min-w-0 border-b px-6 py-6">
            <div className="min-w-0 space-y-3">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <h2 className="text-navy-900 text-app-text-primary min-w-0 break-words text-xl font-semibold leading-snug tracking-tight">
                  Guidance Center
                </h2>
                <div className="flex shrink-0 items-center gap-1">
                  {bundle.kognitosRunUrl ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-app-border text-app-text-secondary h-8 rounded-[10px] px-2 text-xs"
                      asChild
                    >
                      <a href={bundle.kognitosRunUrl} target="_blank" rel="noreferrer">
                        Run
                        <ExternalLink className="ml-1 size-3 opacity-70" />
                      </a>
                    </Button>
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-app-text-secondary size-8"
                        aria-label="More actions"
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem
                        onSelect={() => void copyExceptionId(bundle.exception.exceptionId)}
                      >
                        Copy exception id
                      </DropdownMenuItem>
                      {bundle.kognitosRunUrl ? (
                        <DropdownMenuItem asChild>
                          <a href={bundle.kognitosRunUrl} target="_blank" rel="noreferrer">
                            Open in Kognitos
                          </a>
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={() => setSelectedId(null)}>
                        Close detail
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <h3
                    id="sec-what"
                    className="text-app-text-primary min-w-0 text-sm font-semibold tracking-tight"
                  >
                    What happened
                  </h3>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-[10px] px-2 py-0.5 text-[12px] font-medium tabular-nums",
                      guidanceProcessingIds.has(bundle.exception.exceptionId)
                        ? processingFeedbackPillClass()
                        : statePillClass(bundle.exception.state),
                    )}
                  >
                    {guidanceProcessingIds.has(bundle.exception.exceptionId)
                      ? PROCESSING_FEEDBACK_LABEL
                      : stateVisibleLabel(bundle.exception.state)}
                  </span>
                </div>
                {bundle.exception.descriptionFull ? (
                  <p className="text-app-text-primary min-w-0 break-words text-[13px] leading-relaxed">
                    {whatHappenedOperational(bundle.exception)}
                  </p>
                ) : (
                  <p className="text-app-text-muted text-sm italic">
                    No service description on this exception.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-app-text-secondary border-app-border flex items-center justify-between gap-2 border-b px-5 py-3 text-sm">
            <span>Detail</span>
          </div>
        )}

        <ScrollArea className="min-h-0 min-w-0 max-w-full flex-1">
          <div className="text-app-text-primary min-w-0 max-w-full overflow-x-hidden pb-4 text-[13px]">
            {!selectedId ? (
              <p className="text-app-text-secondary px-5 py-5 text-sm">
                Select an exception from the list to load detail.
              </p>
            ) : null}
            {detailLoading ? (
              <div className="text-app-text-secondary flex items-center gap-2 px-5 py-5 text-sm">
                <Loader2 className="size-4 animate-spin" />
                Loading detail…
              </div>
            ) : null}
            {detailError ? (
              <p className="text-destructive min-w-0 break-words px-5 py-4 text-sm">
                {detailError}
              </p>
            ) : null}
            {bundle ? (
              <>
                {bundle.exception.state === "ARCHIVED" ? (
                  <div className="px-5 py-3">
                    <p className="text-app-text-secondary text-sm leading-relaxed">
                      Archived exceptions are already triaged and hidden from active work.
                      Guidance is read-only for this item.
                    </p>
                  </div>
                ) : (
                  <DetailSection title="Resolution Agent" sectionId="sec-guide">
                    <ChatTranscript
                      messages={messages}
                      agentResolved={Boolean(bundle.eventsAgentIdUsed)}
                      isAgentWorking={isAgentWorking}
                      replyBusy={replyBusy}
                      builderInsight={builderProgress.insight}
                      runId={bundle.exception.runId}
                      onSendEdits={(xml) =>
                        sendReplyMessage(xml, { clearReplyText: false })
                      }
                      onSelectStarter={(payload) => setReplyText(payload)}
                      onCopy={(text) => void copyToClipboard(text)}
                      onRegenerate={() => void regenerateLastUserMessage()}
                      onRetry={(id) => void retryOptimistic(id)}
                      onSubmitFeedback={(id, rating) =>
                        void submitFeedback(id, rating)
                      }
                      onSelectChoice={(choice) => setReplyText(choice)}
                      onOpenDocumentViewer={(args) => setDocumentViewer(args)}
                    />
                    <ChatComposer
                      value={replyText}
                      onChange={setReplyText}
                      onSubmit={() => void submitReply()}
                      onStop={() => void stopGeneration()}
                      isAgentWorking={isAgentWorking}
                      replyBusy={replyBusy}
                      replyError={replyError}
                    />
                  </DetailSection>
                )}
                <Separator className="bg-app-border" />
                <details className="border-app-border bg-app-surface-muted/60 group mx-5 my-2 rounded-[12px] border open:bg-app-surface">
                  <summary className="text-app-text-primary cursor-pointer list-none px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                    <span className="inline-flex items-center gap-2">
                      <ChevronRight className="text-app-text-muted size-4 shrink-0 transition-transform group-open:rotate-90" />
                      Context
                    </span>
                  </summary>
                  <div className="border-app-border border-t px-4 pb-4 pt-2">
                    {!bundle.runContext.foundInDb ? (
                      <p className="text-app-text-muted text-[13px] leading-snug">
                        No matching run in this app’s database (sync may be missing for this run
                        id).
                      </p>
                    ) : (
                      <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                        {bundle.runContext.keyValues.map((kv) => (
                          <div
                            key={kv.label}
                            className="border-app-border min-w-0 border-b pb-2 last:border-0 sm:odd:border-r sm:odd:pr-3"
                          >
                            <dt className="text-app-text-muted text-[12px] font-medium">
                              {kv.label}
                            </dt>
                            <dd className="text-app-text-primary mt-1 min-w-0 break-words font-medium leading-snug [overflow-wrap:anywhere]">
                              {kv.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {bundle.runContext.inputFiles.length > 0 ? (
                      <div className="mt-3 min-w-0">
                        <p className="text-app-text-muted mb-1 text-[12px] font-medium">
                          Input files
                        </p>
                        <ul className="text-app-text-secondary min-w-0 space-y-0.5 font-sans text-[13px] leading-tight">
                          {bundle.runContext.inputFiles.map((f, i) => (
                            <li
                              key={`${f.inputKey}:${f.kognitosFileId ?? ""}:${f.fileName ?? ""}:${i}`}
                              className="min-w-0 break-all [overflow-wrap:anywhere]"
                              title={`${f.inputKey}: ${f.fileName ?? f.kognitosFileId ?? "file"}`}
                            >
                              <span className="text-app-text-muted">{f.inputKey}:</span>{" "}
                              {f.fileName ?? f.kognitosFileId ?? "file"}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </details>
                <details className="border-app-border bg-app-surface-muted/60 group mx-5 my-2 rounded-[12px] border open:bg-app-surface">
                  <summary className="text-app-text-primary cursor-pointer list-none px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                    <span className="inline-flex items-center gap-2">
                      <ChevronRight className="text-app-text-muted size-4 shrink-0 transition-transform group-open:rotate-90" />
                      Activity
                    </span>
                  </summary>
                  <div className="border-app-border border-t px-4 pb-4 pt-2">
                    {!bundle.eventsAgentIdUsed ? (
                      <p className="text-app-text-muted text-[12px] leading-snug [overflow-wrap:anywhere]">
                        Resolution events could not be loaded from Kognitos (check base URL,
                        credentials, and org/workspace scope).
                      </p>
                    ) : null}
                    {guidancePollTimeoutNotice ? (
                      <p className="text-app-text-secondary mb-2 rounded-[10px] border border-dashed border-app-border bg-app-surface-muted/50 px-3 py-2 text-[12px] leading-snug">
                        {guidancePollTimeoutNotice}
                      </p>
                    ) : null}
                    <EventList
                      events={bundle.events}
                      agentResolved={Boolean(bundle.eventsAgentIdUsed)}
                    />
                  </div>
                </details>

                <details className="border-app-border bg-app-surface-muted/60 group mx-5 my-2 rounded-[12px] border open:bg-app-surface">
                  <summary className="text-app-text-primary hover:bg-app-surface-muted/80 cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
                    <span className="flex flex-col gap-0.5">
                      <span className="inline-flex items-center gap-2 text-sm font-semibold">
                        <ChevronRight className="text-app-text-muted size-4 shrink-0 transition-transform group-open:rotate-90" />
                        Technical details
                      </span>
                      <span className="text-app-text-muted pl-6 text-[12px] font-normal leading-snug">
                        Execution IDs, run information, and error trace
                      </span>
                    </span>
                  </summary>
                  <div className="border-app-border text-app-text-secondary space-y-4 border-t px-4 pb-4 pt-3">
                    <TechField
                      label="System state"
                      value={bundle.exception.state}
                      mono={false}
                    />
                    <TechField label="Exception ID" value={bundle.exception.exceptionId} mono />
                    <TechField
                      label="Run ID"
                      value={bundle.exception.runId ?? ""}
                      mono
                    />
                    <TechField
                      label="Execution ID"
                      value={bundle.exception.executionId ?? ""}
                      mono
                    />
                    <TechField
                      label="Automation ID"
                      value={bundle.exception.automationId}
                      mono
                    />
                    <TechField
                      label="Byte location"
                      value={byteLocationFromDisplay(bundle.exception.locationDisplay) ?? "—"}
                      mono
                    />
                    {rawLocationForTechnical(bundle.exception.locationDisplay) ? (
                      <TechField
                        label="Location (raw)"
                        value={rawLocationForTechnical(bundle.exception.locationDisplay) ?? ""}
                        mono
                      />
                    ) : null}
                    <TechField
                      label="Assignee"
                      value={bundle.exception.assigneeShort ?? "—"}
                      mono={false}
                    />
                    <div className="min-w-0">
                      <div className="text-app-text-secondary flex flex-wrap items-center justify-between gap-2 font-sans text-[12px] font-medium">
                        <span>Interpreter message</span>
                        {bundle.exception.messageFull.trim() ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-app-text-muted h-7 px-2 text-[11px]"
                            onClick={() => void copyToClipboard(bundle.exception.messageFull)}
                          >
                            <Copy className="mr-1 size-3" aria-hidden />
                            Copy
                          </Button>
                        ) : null}
                      </div>
                      <div className="border-app-border mt-1.5 min-w-0 max-w-full overflow-x-auto rounded-[10px] border bg-app-surface-muted">
                        <pre
                          className="text-app-text-primary max-h-40 min-w-0 max-w-full overflow-y-auto p-2.5 font-mono text-[12px] leading-snug whitespace-pre-wrap break-all [overflow-wrap:anywhere]"
                          tabIndex={0}
                        >
                          {bundle.exception.messageFull.trim()
                            ? bundle.exception.messageFull
                            : "—"}
                        </pre>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-app-text-secondary mb-1 font-sans text-[12px] font-medium">
                        Traceback
                      </div>
                      <div className="border-app-border rounded-[10px] border bg-app-surface-muted p-2.5">
                        <pre className="text-app-text-primary font-mono text-[12px] leading-snug whitespace-pre-wrap break-all">
                          {tracebackFromExtra(bundle.exception.extra) ?? "—"}
                        </pre>
                      </div>
                    </div>
                  </div>
                </details>
              </>
            ) : null}
          </div>
        </ScrollArea>
      </aside>

      {/*
        Document viewer dialog — same `InvoicePdfHighlightViewer` the dashboard
        runs-analyzed table uses. Lives at the page level so it can be opened
        from any chat document-preview widget without nested dialog state.
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
            <InvoicePdfHighlightViewer
              pdfUrl={documentViewer.pdfUrl}
              runId={documentViewer.runId}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Args passed to `onOpenDocumentViewer` when the user clicks a chat document
 * preview's "Open" button. The page mounts an `InvoicePdfHighlightViewer`
 * dialog with these values — same component the dashboard runs-analyzed table
 * uses (PDF + bounding-box overlays + per-field confidence panel).
 */
export type ChatDocumentViewerOpen = {
  pdfUrl: string;
  runId: string;
  label: string;
};

type ChatTranscriptProps = {
  messages: ChatMessageDto[];
  agentResolved: boolean;
  isAgentWorking: boolean;
  replyBusy: boolean;
  /** Synthetic insight string when the agent has been silent for a while. */
  builderInsight: string | null;
  /**
   * Exception's `runId` (when known). Required to open the highlight viewer
   * dialog because field overlays/confidences come from
   * `/api/kognitos/runs/{runId}/payload`.
   */
  runId: string | null;
  onSendEdits: (content: string) => Promise<boolean>;
  /** Called when the user picks an empty-state starter prompt. */
  onSelectStarter: (payload: string) => void;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
  onRetry: (id: string) => void;
  onSubmitFeedback: (id: string, rating: "thumbs_up" | "thumbs_down") => void;
  /** Called when the user picks an inline button-group / suggested-prompt option. */
  onSelectChoice: (value: string) => void;
  /** Open the rich PDF + highlights dialog. Provided by the page. */
  onOpenDocumentViewer: (args: ChatDocumentViewerOpen) => void;
};

function ChatTranscript(props: ChatTranscriptProps) {
  const {
    messages,
    agentResolved,
    isAgentWorking,
    replyBusy,
    builderInsight,
    runId,
    onSendEdits,
    onSelectStarter,
    onCopy,
    onRegenerate,
    onRetry,
    onSubmitFeedback,
    onSelectChoice,
    onOpenDocumentViewer,
  } = props;

  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  /** True when the user has scrolled away from the bottom; freezes autoscroll. */
  const [autoScrollPaused, setAutoScrollPaused] = useState(false);
  /** New-messages chip count while autoscroll is paused. */
  const [pendingNewCount, setPendingNewCount] = useState(0);
  /** Whether the older-messages collapser is open. */
  const [historyOpen, setHistoryOpen] = useState(false);

  // Live ref so the scroll handler reads the latest paused value without re-binding.
  const autoScrollPausedRef = useRef(autoScrollPaused);
  useEffect(() => {
    autoScrollPausedRef.current = autoScrollPaused;
  }, [autoScrollPaused]);

  /** Track the latest related-outputs message id so only it is interactive. */
  const latestRelatedOutputsId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (
        m.kind === "text" &&
        m.role === "agent" &&
        m.widgets.some((w) => w.kind === "related-outputs")
      ) {
        return m.id;
      }
    }
    return null;
  }, [messages]);

  /** Group adjacent thinking messages so we can render them as a single expander. */
  const groupedRows = useMemo(() => groupTranscriptRows(messages), [messages]);

  /**
   * Split into older-collapsed / recent visible buckets when the thread is long.
   *
   * Rules:
   *   1. If the thread is short, show everything.
   *   2. Otherwise show at least the last `HISTORY_RECENT_COUNT` rows.
   *   3. Always extend the visible window backwards to include the user's
   *      most recent message. A single agent turn can produce many rows
   *      (reasoning + multiple tool calls + text + guide entries + more
   *      reasoning), and without this rule the user's own question gets
   *      pushed into the collapsed "earlier messages" section while the
   *      agent's response is still streaming — looks like the message
   *      "disappeared" to the user.
   */
  const { collapsedOlder, visibleRows } = useMemo(() => {
    if (groupedRows.length <= HISTORY_RECENT_COUNT) {
      return { collapsedOlder: [] as TranscriptRow[], visibleRows: groupedRows };
    }
    const recentSplit = groupedRows.length - HISTORY_RECENT_COUNT;
    let lastUserIdx = -1;
    for (let i = groupedRows.length - 1; i >= 0; i -= 1) {
      const row = groupedRows[i];
      if (
        row.kind === "message" &&
        row.message.kind === "text" &&
        row.message.role === "user"
      ) {
        lastUserIdx = i;
        break;
      }
    }
    const split =
      lastUserIdx >= 0 && lastUserIdx < recentSplit ? lastUserIdx : recentSplit;
    if (split <= 0) {
      return { collapsedOlder: [] as TranscriptRow[], visibleRows: groupedRows };
    }
    return {
      collapsedOlder: groupedRows.slice(0, split),
      visibleRows: groupedRows.slice(split),
    };
  }, [groupedRows]);

  // Track scroll position to pause autoscroll when the user reads history.
  // Updates state from the scroll event handler (not from inside an effect body).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
      const atBottom = distanceFromBottom < 32;
      setAutoScrollPaused(!atBottom);
      if (atBottom) setPendingNewCount(0);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // React-to-message-changes via refs and a microtask so we never call
  // setState directly inside an effect body (avoids the React 19 lint rule).
  const lastMessageCountRef = useRef(messages.length);
  useEffect(() => {
    const prev = lastMessageCountRef.current;
    lastMessageCountRef.current = messages.length;
    if (messages.length === 0) {
      // Schedule reset outside the effect body.
      queueMicrotask(() => {
        setHistoryOpen(false);
        setPendingNewCount(0);
        setAutoScrollPaused(false);
      });
      return;
    }
    const grew = messages.length > prev;
    if (!grew) return;
    if (autoScrollPausedRef.current) {
      queueMicrotask(() => setPendingNewCount((c) => c + 1));
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  function jumpToBottom() {
    setAutoScrollPaused(false);
    setPendingNewCount(0);
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  return (
    <div
      className="border-app-border bg-app-surface-muted/30 mt-3 min-w-0 rounded-[12px] border"
      role="region"
      aria-label="Conversation with the resolution agent"
    >
      <div
        ref={scrollerRef}
        className="relative max-h-[min(28rem,55vh)] min-w-0 overflow-y-auto px-3.5 py-3"
      >
        {messages.length === 0 ? (
          <ChatEmptyState
            agentResolved={agentResolved}
            disabled={replyBusy || isAgentWorking}
            onSelectStarter={onSelectStarter}
          />
        ) : (
          <ul className="flex min-w-0 flex-col gap-3">
            {collapsedOlder.length > 0 ? (
              <li className="flex min-w-0 justify-center">
                <button
                  type="button"
                  className="text-app-text-secondary hover:bg-app-surface-muted/70 inline-flex items-center gap-1.5 rounded-[10px] border border-app-border bg-app-surface/80 px-2.5 py-1 text-[11px] font-medium"
                  onClick={() => setHistoryOpen((o) => !o)}
                  aria-expanded={historyOpen}
                >
                  <ChevronRight
                    className={cn(
                      "size-3 shrink-0 transition-transform",
                      historyOpen && "rotate-90",
                    )}
                    aria-hidden
                  />
                  {historyOpen
                    ? `Hide ${collapsedOlder.length} earlier messages`
                    : `Show ${collapsedOlder.length} earlier messages`}
                </button>
              </li>
            ) : null}
            {historyOpen
              ? collapsedOlder.map((row) => (
                  <TranscriptRowView
                    key={row.id}
                    row={row}
                    isLatestRelatedOutputs={
                      row.kind === "message" && row.message.id === latestRelatedOutputsId
                    }
                    disabled={isAgentWorking || replyBusy}
                    runId={runId}
                    onSendEdits={onSendEdits}
                    onCopy={onCopy}
                    onRegenerate={onRegenerate}
                    onRetry={onRetry}
                    onSubmitFeedback={onSubmitFeedback}
                    onSelectChoice={onSelectChoice}
                    onOpenDocumentViewer={onOpenDocumentViewer}
                  />
                ))
              : null}
            {visibleRows.map((row) => (
              <TranscriptRowView
                key={row.id}
                row={row}
                isLatestRelatedOutputs={
                  row.kind === "message" && row.message.id === latestRelatedOutputsId
                }
                disabled={isAgentWorking || replyBusy}
                runId={runId}
                onSendEdits={onSendEdits}
                onCopy={onCopy}
                onRegenerate={onRegenerate}
                onRetry={onRetry}
                onSubmitFeedback={onSubmitFeedback}
                onSelectChoice={onSelectChoice}
                onOpenDocumentViewer={onOpenDocumentViewer}
              />
            ))}
            {builderInsight ? (
              <li className="flex min-w-0 items-start gap-2 self-start">
                <div
                  className="bg-navy-900 text-white mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
                  aria-hidden
                >
                  <Sparkles className="size-3.5" />
                </div>
                <div className="border-app-border bg-app-surface text-app-text-muted flex max-w-[80%] items-center gap-1.5 rounded-[12px] border px-3 py-2 text-[12px] italic leading-snug">
                  <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
                  <span className="min-w-0">{builderInsight}</span>
                </div>
              </li>
            ) : isAgentWorking ? (
              <li className="flex min-w-0 items-center gap-2 self-start">
                <div
                  className="bg-navy-900 text-white mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
                  aria-hidden
                >
                  <Bot className="size-3.5" />
                </div>
                <div className="border-app-border bg-app-surface text-app-text-muted flex items-center gap-1.5 rounded-[12px] border px-3 py-2 text-[12px]">
                  <span className="flex gap-1">
                    <span className="bg-app-text-muted size-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
                    <span className="bg-app-text-muted size-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
                    <span className="bg-app-text-muted size-1.5 animate-bounce rounded-full" />
                  </span>
                </div>
              </li>
            ) : null}
          </ul>
        )}
        <div ref={bottomRef} />
        {pendingNewCount > 0 && autoScrollPaused ? (
          <div className="pointer-events-none sticky bottom-2 flex justify-center">
            <button
              type="button"
              onClick={jumpToBottom}
              className="bg-navy-900 hover:bg-navy-800 pointer-events-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium text-white shadow-md"
            >
              <ChevronDown className="size-3.5" aria-hidden />
              {pendingNewCount === 1
                ? "1 new message"
                : `${pendingNewCount} new messages`}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type NonThinkingMessage = Exclude<ChatMessageDto, ChatThinkingMessage>;

/** Visual row in the transcript: either a single `ChatMessageDto` or a thinking-group. */
type TranscriptRow =
  | { kind: "message"; id: string; message: NonThinkingMessage }
  | {
      kind: "thinking-group";
      id: string;
      messages: ChatThinkingMessage[];
    };

function groupTranscriptRows(messages: ChatMessageDto[]): TranscriptRow[] {
  const out: TranscriptRow[] = [];
  let buffer: ChatThinkingMessage[] = [];
  const flushThinking = () => {
    if (buffer.length === 0) return;
    out.push({
      kind: "thinking-group",
      id: `thinking:${buffer[0].id}`,
      messages: buffer,
    });
    buffer = [];
  };
  for (const m of messages) {
    if (m.kind === "thinking") {
      buffer.push(m);
      continue;
    }
    flushThinking();
    out.push({ kind: "message", id: m.id, message: m });
  }
  flushThinking();
  return out;
}

type RowProps = {
  row: TranscriptRow;
  isLatestRelatedOutputs: boolean;
  disabled: boolean;
  /** Exception's runId (for opening the highlight viewer dialog). */
  runId: string | null;
  onSendEdits: (content: string) => Promise<boolean>;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
  onRetry: (id: string) => void;
  onSubmitFeedback: (id: string, rating: "thumbs_up" | "thumbs_down") => void;
  onSelectChoice: (value: string) => void;
  onOpenDocumentViewer: (args: ChatDocumentViewerOpen) => void;
};

function TranscriptRowView(props: RowProps) {
  const { row } = props;
  if (row.kind === "thinking-group") {
    return (
      <li className="flex min-w-0 justify-start">
        <ThinkingRow messages={row.messages} />
      </li>
    );
  }

  const m = row.message;
  if (m.kind === "tool-call") {
    return (
      <li className="flex min-w-0 justify-start">
        <ToolCallRow message={m} />
      </li>
    );
  }
  if (m.kind === "system-error") {
    return (
      <li className="flex min-w-0 justify-start">
        <SystemErrorRow
          message={m}
          onRetry={() => props.onRegenerate()}
          disabled={props.disabled}
        />
      </li>
    );
  }
  if (m.kind === "system-completion") {
    return (
      <li className="flex min-w-0 justify-start">
        <SystemCompletionRow
          message={m}
          onSubmitFeedback={(rating) => props.onSubmitFeedback(m.id, rating)}
        />
      </li>
    );
  }

  return (
    <TextMessageRow
      message={m}
      isLatestRelatedOutputs={props.isLatestRelatedOutputs}
      disabled={props.disabled}
      runId={props.runId}
      onSendEdits={props.onSendEdits}
      onCopy={props.onCopy}
      onRegenerate={props.onRegenerate}
      onRetry={props.onRetry}
      onSelectChoice={props.onSelectChoice}
      onOpenDocumentViewer={props.onOpenDocumentViewer}
    />
  );
}

function TextMessageRow({
  message: m,
  isLatestRelatedOutputs,
  disabled,
  runId,
  onSendEdits,
  onCopy,
  onRegenerate,
  onRetry,
  onSelectChoice,
  onOpenDocumentViewer,
}: {
  message: ChatTextMessage;
  isLatestRelatedOutputs: boolean;
  disabled: boolean;
  runId: string | null;
  onSendEdits: (content: string) => Promise<boolean>;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
  onRetry: (id: string) => void;
  onSelectChoice: (value: string) => void;
  onOpenDocumentViewer: (args: ChatDocumentViewerOpen) => void;
}) {
  const failed = m.status === "failed";
  const sending = m.status === "sending";
  return (
    <li
      className={cn(
        "group flex min-w-0 gap-2",
        m.role === "user" ? "justify-end" : "justify-start",
      )}
    >
      {m.role === "agent" ? (
        <div
          className="bg-navy-900 text-white mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
          aria-hidden
        >
          <Bot className="size-3.5" />
        </div>
      ) : null}
      <div
        className={cn(
          "flex min-w-0 max-w-[85%] flex-col gap-1.5",
          m.role === "user" ? "items-end" : "items-start",
        )}
      >
        {m.content ? (
          <div
            className={cn(
              "min-w-0 rounded-[12px] px-3 py-2 text-[13px] leading-relaxed shadow-[0_1px_0_rgba(15,23,42,0.04)] [overflow-wrap:anywhere]",
              m.role === "user"
                ? failed
                  ? "border border-destructive bg-destructive/10 text-app-text-primary"
                  : "bg-navy-900 text-white"
                : "border-app-border bg-app-surface text-app-text-primary border",
              sending && m.role === "user" ? "opacity-75" : null,
            )}
          >
            {m.role === "agent" ? (
              <div
                className={cn(
                  "prose-sm max-w-none",
                  "[&_a]:text-navy-800 [&_a]:underline",
                  "[&_code]:rounded [&_code]:bg-app-surface-muted [&_code]:px-1 [&_code]:text-[12px]",
                  "[&_li]:my-0.5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5",
                  "[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
                  "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5",
                  "[&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-app-surface-muted [&_pre]:p-2 [&_pre]:text-[12px]",
                )}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {m.content || (m.isStreaming ? "…" : "")}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="whitespace-pre-wrap">{m.content}</p>
            )}
          </div>
        ) : null}
        {m.widgets.map((w, wi) => (
          <ChatMessageWidget
            key={`${m.id}-w${wi}`}
            widget={w}
            interactive={isLatestRelatedOutputs && w.kind === "related-outputs"}
            disabled={disabled}
            runId={runId}
            onSendEdits={onSendEdits}
            onSelectChoice={onSelectChoice}
            onOpenDocumentViewer={onOpenDocumentViewer}
          />
        ))}
        <div
          className={cn(
            "flex min-w-0 items-center gap-2",
            m.role === "user" ? "self-end" : "self-start pl-0.5",
          )}
        >
          <span className="text-app-text-muted font-mono text-[10px] leading-none tabular-nums">
            {m.createTime ? new Date(m.createTime).toLocaleString() : ""}
          </span>
          {sending ? (
            <span className="text-app-text-muted inline-flex items-center gap-1 text-[10px]">
              <Loader2 className="size-2.5 animate-spin" aria-hidden />
              Sending…
            </span>
          ) : failed ? (
            <button
              type="button"
              className="text-destructive inline-flex items-center gap-1 text-[10px] underline-offset-2 hover:underline"
              onClick={() => onRetry(m.id)}
            >
              <RotateCw className="size-2.5" aria-hidden />
              Failed — retry
            </button>
          ) : (
            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              {m.content ? (
                <button
                  type="button"
                  aria-label="Copy message"
                  className="text-app-text-muted hover:bg-app-surface-muted/80 rounded p-0.5"
                  onClick={() => onCopy(m.content)}
                >
                  <Copy className="size-3" aria-hidden />
                </button>
              ) : null}
              {m.role === "user" && !sending ? (
                <button
                  type="button"
                  aria-label="Re-send this message"
                  className="text-app-text-muted hover:bg-app-surface-muted/80 rounded p-0.5"
                  onClick={() => onRegenerate()}
                  disabled={disabled}
                >
                  <RotateCw className="size-3" aria-hidden />
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
      {m.role === "user" ? (
        <div
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
            failed
              ? "border-destructive bg-destructive/10 text-destructive"
              : "border-app-border bg-app-surface text-app-text-secondary",
          )}
          aria-hidden
        >
          {failed ? (
            <AlertTriangle className="size-3.5" />
          ) : (
            <UserIcon className="size-3.5" />
          )}
        </div>
      ) : null}
    </li>
  );
}

function ThinkingRow({ messages }: { messages: ChatThinkingMessage[] }) {
  const [open, setOpen] = useState(false);
  const isStreaming = messages.some((m) => m.isStreaming);
  const stepLabel = messages.length === 1 ? "1 step" : `${messages.length} steps`;
  return (
    <div className="flex min-w-0 items-start gap-2 self-start">
      <div
        className="bg-app-surface-muted text-app-text-secondary mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
        aria-hidden
      >
        <Brain className="size-3.5" />
      </div>
      <div className="border-app-border bg-app-surface text-app-text-secondary min-w-0 max-w-[85%] rounded-[12px] border px-3 py-2 text-[12px] leading-snug">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 font-medium"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <ChevronRight
            className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
            aria-hidden
          />
          {isStreaming ? (
            <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
          ) : null}
          <span>
            Agent reasoning · {stepLabel}
            {isStreaming ? " · streaming" : ""}
          </span>
        </button>
        {open ? (
          <div className="border-app-border/60 mt-2 space-y-2 border-t pt-2">
            {messages.map((m, i) => (
              <div key={m.id} className="text-app-text-secondary min-w-0">
                <p className="text-app-text-muted text-[10px] font-mono leading-none">
                  Step {i + 1}
                  {m.createTime
                    ? ` · ${new Date(m.createTime).toLocaleTimeString()}`
                    : ""}
                </p>
                <div
                  className={cn(
                    "prose-sm mt-1 max-w-none text-[12px]",
                    "[&_a]:text-navy-800 [&_a]:underline",
                    "[&_code]:rounded [&_code]:bg-app-surface-muted [&_code]:px-1 [&_code]:text-[11px]",
                    "[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
                  )}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {m.content}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function friendlyToolVerb(displayName: string): string {
  const dn = displayName.trim();
  const lower = dn.toLowerCase();
  if (!lower) return "Running tool";
  if (/(^|\W)(search|find|lookup)/.test(lower)) return `Searching ${dn}`;
  if (/(^|\W)(get|fetch|read)/.test(lower)) return `Fetching ${dn}`;
  if (/(^|\W)(create|insert|post)/.test(lower)) return `Creating ${dn}`;
  if (/(^|\W)(update|patch|edit)/.test(lower)) return `Updating ${dn}`;
  if (/(^|\W)(delete|remove)/.test(lower)) return `Removing ${dn}`;
  return dn;
}

function ToolCallRow({ message: m }: { message: ChatToolCallMessage }) {
  const elapsedMs =
    m.resultTime && m.createTime
      ? new Date(m.resultTime).getTime() - new Date(m.createTime).getTime()
      : null;
  const done = m.result !== undefined && !m.isStreaming;
  const verb = friendlyToolVerb(m.displayName);
  return (
    <div
      className="border-app-border bg-app-surface min-w-0 max-w-[85%] rounded-[12px] border px-3 py-2 text-[12px] leading-snug"
      role="status"
    >
      <div className="text-app-text-primary flex min-w-0 items-center gap-2">
        {done ? (
          <CheckCircle2 className="text-app-green size-3.5 shrink-0" aria-hidden />
        ) : (
          <Loader2 className="text-navy-700 size-3.5 shrink-0 animate-spin" aria-hidden />
        )}
        <Wrench className="text-app-text-muted size-3 shrink-0" aria-hidden />
        <span className="min-w-0 truncate font-medium">{verb}…</span>
        {elapsedMs !== null ? (
          <span className="text-app-text-muted ml-auto shrink-0 font-mono tabular-nums text-[10px]">
            {(elapsedMs / 1000).toFixed(1)}s
          </span>
        ) : null}
      </div>
      {m.input ? (
        <pre className="text-app-text-muted bg-app-surface-muted/60 mt-1.5 max-h-16 overflow-y-auto whitespace-pre-wrap break-all rounded p-1.5 font-mono text-[10px] leading-snug">
          {m.input.slice(0, 240)}
          {m.input.length > 240 ? "…" : ""}
        </pre>
      ) : null}
    </div>
  );
}

function SystemErrorRow({
  message,
  onRetry,
  disabled,
}: {
  message: ChatSystemErrorMessage;
  onRetry: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className="text-destructive border-destructive/40 bg-destructive/5 min-w-0 max-w-[85%] rounded-[12px] border px-3 py-2 text-[12px] leading-snug"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Agent error</p>
          <p className="text-app-text-primary mt-0.5 break-words">{message.message}</p>
          {message.detail && message.detail !== message.message ? (
            <pre className="text-app-text-muted mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-all rounded bg-app-surface-muted/60 p-1.5 font-mono text-[10px] leading-snug">
              {message.detail}
            </pre>
          ) : null}
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 h-7 rounded-[8px] px-2 text-[11px]"
              disabled={disabled}
              onClick={onRetry}
            >
              <RotateCw className="mr-1 size-3" aria-hidden />
              Retry
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SystemCompletionRow({
  message,
  onSubmitFeedback,
}: {
  message: ChatSystemCompletionMessage;
  onSubmitFeedback: (rating: "thumbs_up" | "thumbs_down") => void;
}) {
  const [rating, setRating] = useState<null | "thumbs_up" | "thumbs_down">(null);
  return (
    <div
      className="border-app-green-border/60 bg-app-green-bg text-navy-900 min-w-0 max-w-[85%] rounded-[12px] border px-3 py-2 text-[12px] leading-snug"
      role="status"
    >
      <div className="flex items-start gap-2">
        <CheckCircle2 className="text-app-green mt-0.5 size-3.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Agent finished</p>
          {message.content ? (
            <p className="text-app-text-primary mt-0.5 whitespace-pre-wrap break-words">
              {message.content}
            </p>
          ) : null}
          <div className="text-app-text-secondary mt-2 flex items-center gap-2 text-[11px]">
            <span>Was this helpful?</span>
            <button
              type="button"
              aria-label="Mark helpful"
              aria-pressed={rating === "thumbs_up"}
              className={cn(
                "hover:bg-app-surface-muted/80 rounded p-1 transition-colors",
                rating === "thumbs_up" && "bg-app-surface-muted/80 text-app-green",
              )}
              onClick={() => {
                setRating("thumbs_up");
                onSubmitFeedback("thumbs_up");
              }}
            >
              <ThumbsUp className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Mark unhelpful"
              aria-pressed={rating === "thumbs_down"}
              className={cn(
                "hover:bg-app-surface-muted/80 rounded p-1 transition-colors",
                rating === "thumbs_down" && "bg-app-surface-muted/80 text-destructive",
              )}
              onClick={() => {
                setRating("thumbs_down");
                onSubmitFeedback("thumbs_down");
              }}
            >
              <ThumbsDown className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatEmptyState({
  agentResolved,
  disabled,
  onSelectStarter,
}: {
  agentResolved: boolean;
  disabled: boolean;
  onSelectStarter: (payload: string) => void;
}) {
  return (
    <div className="text-app-text-secondary min-w-0 rounded-[10px] border border-dashed border-app-border bg-app-surface/60 px-3 py-3">
      <p className="text-app-text-primary text-[13px] font-medium">No messages yet.</p>
      <p className="text-app-text-muted mt-1 text-[12px] leading-snug">
        {agentResolved
          ? "Send guidance below to start a conversation with the resolution agent."
          : "Configure an exception-resolution agent id to start a conversation."}
      </p>
      {agentResolved ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {STARTER_PROMPTS.map((p) => (
            <Button
              key={p.label}
              type="button"
              variant="outline"
              size="sm"
              className="border-app-border text-app-text-primary h-7 rounded-full px-2.5 text-[11px]"
              disabled={disabled}
              onClick={() => onSelectStarter(p.payload)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChatMessageWidget({
  widget,
  interactive,
  disabled,
  runId,
  onSendEdits,
  onSelectChoice,
  onOpenDocumentViewer,
}: {
  widget: ChatWidget;
  /** True only for the most recent `related-outputs` widget. */
  interactive: boolean;
  /** Suppress interaction (e.g. while the agent is processing). */
  disabled: boolean;
  runId: string | null;
  onSendEdits: (content: string) => Promise<boolean>;
  onSelectChoice: (value: string) => void;
  onOpenDocumentViewer: (args: ChatDocumentViewerOpen) => void;
}) {
  if (widget.kind === "related-outputs") {
    return (
      <RelatedOutputsCard
        data={widget.data}
        interactive={interactive}
        disabled={disabled}
        onSendEdits={onSendEdits}
      />
    );
  }
  if (widget.kind === "guide-entry") {
    return <GuideEntryCard data={widget.data} />;
  }
  if (widget.kind === "edit-facts") {
    return <EditFactsCard facts={widget.data} />;
  }
  if (widget.kind === "button-group") {
    return (
      <ButtonGroupCard
        choice={widget.data}
        disabled={disabled}
        onSelect={onSelectChoice}
      />
    );
  }
  if (widget.kind === "form-fields") {
    return (
      <FormFieldsCard
        data={widget.data}
        disabled={disabled || !interactive}
        onSubmit={onSendEdits}
      />
    );
  }
  return (
    <DocumentPreviewCard
      data={widget.data}
      runId={runId}
      onOpenDocumentViewer={onOpenDocumentViewer}
    />
  );
}

function FormFieldsCard({
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
    for (const f of data.fields) {
      if (f.default !== undefined) init[f.name] = f.default;
    }
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);

  const missingRequired = useMemo(
    () =>
      data.fields
        .filter((f) => f.required)
        .filter((f) => !values[f.name]?.trim()),
    [data.fields, values],
  );
  const canSubmit =
    !disabled && !submitting && missingRequired.length === 0 && data.fields.length > 0;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const xml = buildFormFieldsXml(data, values);
      const ok = await onSubmit(xml);
      if (ok) {
        setJustSubmitted(true);
        setValues({});
      } else {
        setSubmitError("Could not send. Check the message panel below.");
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "send_failed");
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, data, values, onSubmit]);

  return (
    <div
      className="border-app-border bg-app-surface text-app-text-primary min-w-0 max-w-full rounded-[12px] border px-3 py-2.5 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
      role="group"
      aria-label={data.title ?? "Agent form"}
    >
      <div className="flex items-start gap-2">
        <Pencil className="text-app-text-secondary mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold leading-snug">
            {data.title ?? "Provide the requested information"}
          </p>
          {data.description ? (
            <p className="text-app-text-muted mt-0.5 text-[11px] leading-snug">
              {data.description}
            </p>
          ) : null}
          <ul className="mt-2 flex flex-col gap-2">
            {data.fields.map((f) => (
              <li key={f.name} className="min-w-0">
                <FormFieldInput
                  field={f}
                  value={values[f.name] ?? ""}
                  onChange={(next) =>
                    setValues((prev) => ({ ...prev, [f.name]: next }))
                  }
                  disabled={disabled || submitting}
                  onSubmit={handleSubmit}
                />
              </li>
            ))}
          </ul>
          <div className="border-app-border/70 mt-2.5 flex flex-col gap-1.5 border-t pt-2.5">
            {submitError ? (
              <p className="text-destructive text-[11px] leading-snug">{submitError}</p>
            ) : null}
            {justSubmitted ? (
              <p className="text-app-text-muted text-[11px] leading-snug">
                Sent. The agent will respond shortly.
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <span className="text-app-text-muted text-[11px]">
                {missingRequired.length === 0
                  ? "All required fields are filled."
                  : `${missingRequired.length} required field${
                      missingRequired.length === 1 ? "" : "s"
                    } remaining`}
              </span>
              <Button
                type="button"
                size="sm"
                className={cn(
                  "h-8 min-w-[6.5rem] rounded-[10px] text-[12px] font-medium [&_svg]:shrink-0",
                  !canSubmit
                    ? "cursor-not-allowed border border-slate-300 bg-[#E2E8F0] text-[#64748B] hover:bg-[#E2E8F0] [&_svg]:text-[#64748B]"
                    : "bg-navy-900 text-white hover:bg-navy-800 [&_svg]:text-white",
                )}
                disabled={!canSubmit}
                onClick={() => void handleSubmit()}
              >
                {submitting ? (
                  <Loader2 className="mr-1 size-3 animate-spin" aria-hidden />
                ) : (
                  <Send className="mr-1 size-3" aria-hidden />
                )}
                {submitting ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormFieldInput({
  field,
  value,
  onChange,
  disabled,
  onSubmit,
}: {
  field: ChatFormField;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  onSubmit: () => void;
}) {
  const id = `form-field-${field.name}`;
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label
        htmlFor={id}
        className="text-app-text-secondary text-[12px] font-medium"
      >
        {field.label}
        {field.required ? <span className="text-destructive ml-1">*</span> : null}
      </label>
      {field.type === "select" && field.options && field.options.length > 0 ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="border-app-border bg-app-surface text-app-text-primary h-8 rounded-[8px] border px-2 text-[12px]"
        >
          <option value="">{field.placeholder ?? "Select an option"}</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? `Enter ${field.label}`}
          disabled={disabled}
          type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
          inputMode={field.type === "number" ? "decimal" : "text"}
          className="border-app-border bg-app-surface text-app-text-primary h-8 rounded-[8px] text-[12px]"
          onKeyDown={onKeyDown}
        />
      )}
    </div>
  );
}

/** Serialize a form-fields response into a Kognitos `<user_action>` payload. */
function buildFormFieldsXml(
  data: ChatFormFieldsData,
  values: Record<string, string>,
): string {
  const xmlEscape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  const fieldsXml = data.fields
    .map((f) => {
      const v = values[f.name] ?? "";
      return `  <field name="${xmlEscape(f.name)}" type="${f.type}">${xmlEscape(v)}</field>`;
    })
    .join("\n");
  return `<user_action type="form_response">\n${fieldsXml}\n</user_action>`;
}

function ButtonGroupCard({
  choice,
  disabled,
  onSelect,
}: {
  choice: ExceptionStructuredChoiceDto;
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <div
      className="border-app-border bg-app-surface text-app-text-primary min-w-0 max-w-full rounded-[12px] border px-3 py-2.5 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
      role="group"
      aria-label="Suggested replies"
    >
      <p className="text-[12px] font-semibold leading-snug">Suggested replies</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {choice.options.map((opt, i) => (
          <li key={`${i}:${opt.slice(0, 80)}`}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              className="border-app-border text-app-text-primary h-auto min-h-9 w-full max-w-full justify-start whitespace-normal rounded-[10px] px-3 py-1.5 text-left text-[12px] font-normal leading-snug"
              onClick={() => onSelect(opt)}
            >
              {opt}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function inferMimeFromLabel(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const ext = label.match(/\.([A-Za-z0-9]{1,10})$/)?.[1]?.toLowerCase();
  if (!ext) return undefined;
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  return undefined;
}

function DocumentPreviewCard({
  data,
  runId,
  onOpenDocumentViewer,
}: {
  data: ChatDocumentPreviewData;
  /**
   * Exception's runId — when present alongside `data.fileId`, the "Open"
   * button launches the rich highlight viewer (PDF + bounding boxes +
   * confidence panel) instead of just opening the file in a new tab.
   */
  runId: string | null;
  onOpenDocumentViewer: (args: ChatDocumentViewerOpen) => void;
}) {
  const href = data.url
    ? data.url
    : data.fileId
      ? `/api/kognitos/files/${encodeURIComponent(data.fileId)}`
      : null;
  const downloadHref =
    href && data.fileId && !data.url
      ? `${href}?download=1`
      : href;
  const effectiveMime = data.mimeType ?? inferMimeFromLabel(data.label);
  const isPdf = effectiveMime === "application/pdf";
  const isImage = !!effectiveMime && effectiveMime.startsWith("image/");
  const canPreview = !!href && (isPdf || isImage);

  // The highlight viewer needs both a runId (for /payload highlight data) and
  // a PDF URL. Use it for PDFs only — images don't have IDP overlays.
  const canOpenInViewer = !!href && isPdf && !!runId;

  return (
    <div
      className="border-app-border bg-app-surface text-app-text-primary min-w-0 max-w-full overflow-hidden rounded-[12px] border shadow-[0_1px_0_rgba(15,23,42,0.04)]"
      role="group"
      aria-label="Document attachment"
    >
      {canPreview ? (
        <button
          type="button"
          className={cn(
            "bg-app-surface-muted/40 border-app-border relative block h-[280px] w-full overflow-hidden border-b",
            canOpenInViewer
              ? "focus-visible:ring-ring/40 cursor-zoom-in focus-visible:outline-none focus-visible:ring-2"
              : "cursor-default",
          )}
          onClick={
            canOpenInViewer && href && runId
              ? () =>
                  onOpenDocumentViewer({ pdfUrl: href, runId, label: data.label })
              : undefined
          }
          aria-label={
            canOpenInViewer
              ? `Open ${data.label} in document viewer`
              : data.label
          }
          tabIndex={canOpenInViewer ? 0 : -1}
        >
          {isPdf ? (
            // Inline preview only — pointer events disabled so the parent
            // button captures the click and opens the highlight viewer.
            <object
              data={`${href}#view=FitH&toolbar=0`}
              type="application/pdf"
              className="pointer-events-none h-full w-full"
              aria-label={data.label}
            >
              <div className="text-app-text-secondary flex h-full items-center justify-center text-[12px]">
                Preview unavailable
              </div>
            </object>
          ) : (
            // Chat attachments come from /api/kognitos/files/[id] (proxy of an
            // org-level Kognitos file). Dimensions are unknown, the URL isn't
            // CDN-cacheable, and next/image's loader doesn't add value here —
            // a plain <img> with object-contain matches our use case better.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={href ?? ""}
              alt={data.label}
              className="h-full w-full object-contain"
              loading="lazy"
            />
          )}
          {canOpenInViewer ? (
            <span className="bg-navy-900/85 pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white shadow-sm">
              <Maximize2 className="size-2.5" aria-hidden />
              Open viewer
            </span>
          ) : null}
        </button>
      ) : null}
      <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
        <div
          className="bg-app-surface-muted text-app-text-secondary flex size-9 shrink-0 items-center justify-center rounded-[10px]"
          aria-hidden
        >
          <Paperclip className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="text-app-text-primary truncate text-[12px] font-semibold leading-snug"
            title={data.label}
          >
            {data.label}
          </p>
          {effectiveMime ? (
            <p className="text-app-text-muted truncate text-[10px] tabular-nums">
              {effectiveMime}
            </p>
          ) : null}
        </div>
        {href ? (
          <div className="flex shrink-0 items-center gap-1">
            {canOpenInViewer && runId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-app-border text-app-text-secondary h-7 rounded-[10px] text-[11px]"
                onClick={() =>
                  onOpenDocumentViewer({ pdfUrl: href, runId, label: data.label })
                }
              >
                <Maximize2 className="mr-1 size-3 opacity-70" aria-hidden />
                Open
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-app-border text-app-text-secondary h-7 rounded-[10px] text-[11px]"
                asChild
              >
                <a href={href} target="_blank" rel="noreferrer">
                  Open
                  <ExternalLink className="ml-1 size-3 opacity-70" aria-hidden />
                </a>
              </Button>
            )}
            {downloadHref ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-app-text-secondary h-7 rounded-[10px] text-[11px]"
                asChild
                title="Download"
              >
                <a href={downloadHref}>
                  <Download className="size-3.5" aria-hidden />
                  <span className="sr-only">Download {data.label}</span>
                </a>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Composer: textarea + send / stop / suggested actions, with keyboard shortcuts. */
function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  isAgentWorking,
  replyBusy,
  replyError,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isAgentWorking: boolean;
  replyBusy: boolean;
  replyError: string | null;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const composerWrapperRef = useRef<HTMLDivElement>(null);

  // Cmd/Ctrl+Enter submits from anywhere within the composer.
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (value.trim() && !replyBusy && !isAgentWorking) onSubmit();
      } else if (e.key === "Escape" && isAgentWorking) {
        e.preventDefault();
        onStop();
      }
    },
    [value, replyBusy, isAgentWorking, onSubmit, onStop],
  );

  // Document-level Esc: cancel generation when the focus is anywhere in the composer.
  useEffect(() => {
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !isAgentWorking) return;
      const target = e.target as HTMLElement | null;
      if (target && composerWrapperRef.current?.contains(target)) {
        e.preventDefault();
        onStop();
      }
    };
    window.addEventListener("keydown", onDocKey);
    return () => window.removeEventListener("keydown", onDocKey);
  }, [isAgentWorking, onStop]);

  const sendDisabled = replyBusy || isAgentWorking || !value.trim();
  return (
    <div ref={composerWrapperRef}>
      <div className="mt-3">
        <Textarea
          ref={taRef}
          id="exception-reply-message"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Tell the agent how to resolve this exception... (Cmd/Ctrl+Enter to send)"
          aria-label="Message to send"
          rows={Math.min(14, Math.max(4, (value.match(/\n/g)?.length ?? 0) + 4))}
          className="border-app-border bg-app-surface text-app-text-primary min-h-[7.5rem] min-w-0 max-w-full resize-y rounded-[11px] border text-[13px] leading-relaxed whitespace-pre-wrap placeholder:text-app-text-muted"
          disabled={replyBusy || isAgentWorking}
        />
      </div>
      {replyError ? (
        <p className="text-destructive mt-2 min-w-0 whitespace-pre-wrap break-words text-sm">
          {replyError}
        </p>
      ) : null}
      <div className="mt-3 flex items-center justify-end gap-2">
        {isAgentWorking ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-app-border text-app-text-primary h-9 min-w-[8.5rem] rounded-[10px] text-sm font-medium"
            onClick={onStop}
            aria-label="Stop generation"
          >
            <Square className="mr-1.5 size-3.5 fill-current" aria-hidden />
            Stop
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className={cn(
              "h-9 min-w-[8.5rem] rounded-[10px] text-sm font-medium [&_svg]:shrink-0",
              sendDisabled
                ? "cursor-not-allowed border border-slate-300 bg-[#E2E8F0] text-[#64748B] hover:bg-[#E2E8F0] [&_svg]:text-[#64748B]"
                : "bg-navy-900 text-white hover:bg-navy-800 [&_svg]:text-white",
            )}
            disabled={sendDisabled}
            onClick={onSubmit}
          >
            {replyBusy ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send className="mr-1.5 size-3.5" aria-hidden />
                Send guidance
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function relatedOutputsTitle(context: ParsedRelatedOutputs["context"]): string {
  if (context === "need_information") return "Information needed";
  if (context === "analyze_outputs") return "Analysis of extracted fields";
  if (context === "manual_action_required") return "Manual action required";
  return "Document fields";
}

function shortFactSourceLabel(source: ParsedFact["value"] | string | undefined): string | null {
  if (!source) return null;
  const trimmed = source.trim();
  if (!trimmed) return null;
  const slashIdx = trimmed.lastIndexOf("/");
  return slashIdx >= 0 ? trimmed.slice(slashIdx + 1) : trimmed;
}

/** Stable identity for a parsed related-outputs payload, so editor state can reset when it changes. */
function relatedOutputsIdentityKey(data: ParsedRelatedOutputs): string {
  const parts = data.factGroups.map((g) => {
    const src = g.source?.name ?? "";
    const page = g.source?.page ?? "";
    const fields = g.facts.map((f) => `${f.field}:${f.status}`).join(",");
    return `${src}#${page}|${fields}`;
  });
  return `${data.context ?? ""}::${parts.join("||")}`;
}

function RelatedOutputsCard({
  data,
  interactive,
  disabled,
  onSendEdits,
}: {
  data: ParsedRelatedOutputs;
  interactive: boolean;
  disabled: boolean;
  onSendEdits: (content: string) => Promise<boolean>;
}) {
  /** Collapse historical (non-interactive) cards by default to keep the chat scrollable. */
  const [historyOpen, setHistoryOpen] = useState(false);
  if (!interactive && !historyOpen) {
    return (
      <RelatedOutputsCollapsedSummary
        data={data}
        onExpand={() => setHistoryOpen(true)}
      />
    );
  }
  return (
    <RelatedOutputsCardBody
      data={data}
      interactive={interactive}
      disabled={disabled}
      onSendEdits={onSendEdits}
    />
  );
}

function RelatedOutputsCollapsedSummary({
  data,
  onExpand,
}: {
  data: ParsedRelatedOutputs;
  onExpand: () => void;
}) {
  const totalFacts = data.facts.length;
  const missingCount = data.facts.filter((f) => f.status === "missing").length;
  const presentCount = totalFacts - missingCount;
  return (
    <button
      type="button"
      className="border-app-border bg-app-surface text-app-text-secondary hover:bg-app-surface-muted/60 flex min-w-0 max-w-full items-center gap-2 rounded-[12px] border px-3 py-2 text-left text-[12px]"
      onClick={onExpand}
      aria-expanded={false}
    >
      <FileText className="text-app-text-muted size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium">
        {relatedOutputsTitle(data.context)}
      </span>
      {totalFacts > 0 ? (
        <span className="text-app-text-muted shrink-0 font-mono tabular-nums text-[10px]">
          {presentCount} present · {missingCount} missing
        </span>
      ) : null}
      <ChevronRight className="text-app-text-muted size-3 shrink-0" aria-hidden />
    </button>
  );
}

function RelatedOutputsCardBody({
  data,
  interactive,
  disabled,
  onSendEdits,
}: {
  data: ParsedRelatedOutputs;
  interactive: boolean;
  disabled: boolean;
  onSendEdits: (content: string) => Promise<boolean>;
}) {
  const totalFacts = data.facts.length;
  const missingCount = data.facts.filter((f) => f.status === "missing").length;
  const presentCount = totalFacts - missingCount;
  const hasMissing = missingCount > 0;
  /** Show editable inputs only on the latest payload that actually has missing fields. */
  const allowEditing = interactive && hasMissing;

  /** Local edits keyed by field name. Reset whenever the underlying payload changes. */
  const identityKey = useMemo(() => relatedOutputsIdentityKey(data), [data]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const lastIdentityRef = useRef<string>(identityKey);
  if (lastIdentityRef.current !== identityKey) {
    lastIdentityRef.current = identityKey;
  }
  // Reset transient state when the payload identity changes.
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
      const ok = await onSendEdits(xml);
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
  }, [canSubmit, data, edits, onSendEdits]);

  return (
    <div
      className="border-app-border bg-app-surface text-app-text-primary min-w-0 max-w-full rounded-[12px] border px-3 py-2.5 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
      role="group"
      aria-label={relatedOutputsTitle(data.context)}
    >
      <div className="flex items-start gap-2">
        <FileText className="text-app-text-secondary mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[12px] font-semibold leading-snug">
              {relatedOutputsTitle(data.context)}
            </p>
            {totalFacts > 0 ? (
              <span className="text-app-text-muted font-mono text-[10px] tabular-nums">
                {presentCount} present · {missingCount} missing
              </span>
            ) : null}
          </div>
          {data.factGroups.length === 0 ? (
            <p className="text-app-text-muted mt-1 text-[12px] leading-snug">
              No fields were extracted.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {data.factGroups.map((group, gi) => {
                const sourceLabel = shortFactSourceLabel(group.source?.name);
                return (
                  <li key={gi} className="min-w-0">
                    {sourceLabel || group.source?.page !== undefined ? (
                      <p className="text-app-text-secondary mb-1 truncate text-[11px]">
                        {sourceLabel ?? "Source"}
                        {group.source?.page !== undefined
                          ? ` · p. ${group.source.page}`
                          : ""}
                      </p>
                    ) : null}
                    <ul className="border-app-border/70 divide-app-border/70 divide-y rounded-[8px] border bg-app-surface-muted/40">
                      {group.facts.map((f, fi) => (
                        <li
                          key={`${gi}-${fi}`}
                          className="flex min-w-0 flex-col gap-1 px-2.5 py-1.5"
                        >
                          {f.status === "missing" && allowEditing ? (
                            <EditableMissingFact
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
                              <span className="text-app-text-secondary min-w-0 flex-1 truncate text-[12px] font-medium">
                                {f.field}
                              </span>
                              {f.status === "missing" ? (
                                <span className="text-app-text-muted text-[11px] italic">
                                  missing
                                </span>
                              ) : (
                                <span className="text-app-text-primary min-w-0 max-w-[60%] truncate text-right font-mono text-[11px] tabular-nums">
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
            <div className="border-app-border/70 mt-2.5 flex flex-col gap-1.5 border-t pt-2.5">
              {submitError ? (
                <p className="text-destructive text-[11px] leading-snug">
                  {submitError}
                </p>
              ) : null}
              {justSubmitted && filledCount === 0 ? (
                <p className="text-app-text-muted text-[11px] leading-snug">
                  Sent. The agent will respond shortly.
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <span className="text-app-text-muted text-[11px]">
                  {filledCount === 0
                    ? `Fill in the ${missingCount === 1 ? "field" : `${missingCount} fields`} to send`
                    : `${filledCount} of ${missingCount} ready to send`}
                </span>
                <Button
                  type="button"
                  size="sm"
                  className={cn(
                    "h-8 min-w-[6.5rem] rounded-[10px] text-[12px] font-medium [&_svg]:shrink-0",
                    !canSubmit
                      ? "cursor-not-allowed border border-slate-300 bg-[#E2E8F0] text-[#64748B] hover:bg-[#E2E8F0] [&_svg]:text-[#64748B]"
                      : "bg-navy-900 text-white hover:bg-navy-800 [&_svg]:text-white",
                  )}
                  disabled={!canSubmit}
                  onClick={() => void handleSave()}
                >
                  {submitting ? (
                    <Loader2 className="mr-1 size-3 animate-spin" aria-hidden />
                  ) : (
                    <Send className="mr-1 size-3" aria-hidden />
                  )}
                  {submitting ? "Sending…" : "Send"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EditableMissingFact({
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
  const inputId = `idp-fact-${fact.field}`;
  /** Choose `inputMode` so mobile keyboards match the agent's expected type. */
  const inputMode: "text" | "decimal" =
    fact.type.toLowerCase() === "number" ? "decimal" : "text";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label
        htmlFor={inputId}
        className="text-app-text-secondary text-[12px] font-medium"
      >
        {fact.field}
        <span className="text-app-text-muted ml-1.5 text-[10px] font-normal italic">
          missing
        </span>
      </label>
      <Input
        id={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Enter ${fact.field}`}
        disabled={disabled}
        inputMode={inputMode}
        aria-label={`Value for ${fact.field}`}
        className="border-app-border bg-app-surface text-app-text-primary h-8 rounded-[8px] text-[12px]"
        onKeyDown={(e) => {
          // Cmd/Ctrl + Enter submits the whole card without leaving the input.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
    </div>
  );
}

function GuideEntryCard({ data }: { data: ParsedGuideEntry }) {
  const actionLabel =
    data.action === "create"
      ? "Proposed troubleshooting guide"
      : data.action === "update"
        ? "Updated troubleshooting guide"
        : "Applied troubleshooting guide";
  const stateLabel = data.state ? data.state.replace(/^STATE_/, "") : null;
  const resolution = data.resolutionSteps ?? data.legacyContent ?? "";

  return (
    <div
      className="border-app-border bg-app-surface text-app-text-primary min-w-0 max-w-full rounded-[12px] border px-3 py-2.5 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
      role="group"
      aria-label={actionLabel}
    >
      <div className="flex items-start gap-2">
        <BookOpen
          className="text-app-text-secondary mt-0.5 size-4 shrink-0"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[12px] font-semibold leading-snug">{actionLabel}</p>
            {stateLabel ? (
              <span className="border-app-border bg-app-surface-muted/60 text-app-text-secondary rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                {stateLabel}
              </span>
            ) : null}
            {data.version ? (
              <span className="text-app-text-muted font-mono text-[10px] tabular-nums">
                v{data.version}
              </span>
            ) : null}
          </div>
          <p className="text-app-text-primary mt-1 text-[13px] font-medium leading-snug">
            {data.title}
          </p>
          {data.rootCause ? (
            <div className="mt-2">
              <p className="text-app-text-secondary text-[11px] font-medium uppercase tracking-wide">
                Root cause
              </p>
              <p className="text-app-text-primary mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed">
                {data.rootCause}
              </p>
            </div>
          ) : null}
          {resolution ? (
            <div className="mt-2">
              <p className="text-app-text-secondary text-[11px] font-medium uppercase tracking-wide">
                Resolution
              </p>
              <p className="text-app-text-primary mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed">
                {resolution}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EditFactsCard({ facts }: { facts: EditedFact[] }) {
  if (facts.length === 0) return null;
  return (
    <div
      className="border-app-border bg-app-surface text-app-text-primary min-w-0 max-w-full rounded-[12px] border px-3 py-2.5 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
      role="group"
      aria-label="Edited fields"
    >
      <div className="flex items-start gap-2">
        <Pencil className="text-app-text-secondary mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold leading-snug">
            Edited {facts.length === 1 ? "field" : `${facts.length} fields`}
          </p>
          <ul className="border-app-border/70 divide-app-border/70 mt-2 divide-y rounded-[8px] border bg-app-surface-muted/40">
            {facts.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex min-w-0 flex-col gap-0.5 px-2.5 py-1.5"
              >
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="text-app-text-secondary min-w-0 flex-1 truncate text-[12px] font-medium">
                    {f.name}
                  </span>
                  <span className="text-app-text-primary min-w-0 max-w-[60%] truncate text-right font-mono text-[11px] tabular-nums">
                    {f.value}
                  </span>
                </div>
                {f.original && f.original !== f.value ? (
                  <p className="text-app-text-muted truncate text-right font-mono text-[10px] tabular-nums line-through">
                    was {f.original}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
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
      <div className="text-app-text-secondary min-w-0 rounded-[10px] border border-dashed border-app-border bg-app-surface-muted/40 px-3 py-3">
        <p className="text-app-text-primary text-sm font-medium">No guidance has been sent yet.</p>
        <p className="text-app-text-muted mt-1 min-w-0 text-[12px] leading-snug [overflow-wrap:anywhere]">
          {agentResolved
            ? "When you send guidance, activity will appear here."
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
              {ev.createTime ? new Date(ev.createTime).toLocaleString() : "—"}
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
