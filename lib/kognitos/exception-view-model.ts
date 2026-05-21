import {
  extractFileRefsFromKognitosPayload,
  normalizeKognitosFileIdForDownload,
} from "./extract-run-input-files";
import { normalizeKognitosRowForDashboard } from "./normalize-dashboard-run";
import {
  automationResourceStringFromExceptionRaw,
  runResourceStringFromExceptionRaw,
} from "./exception-raw-resource-strings";
import {
  automationShortIdFromAutomationResourceName,
  exceptionShortIdFromExceptionResourceName,
  runShortIdFromRunResourceName,
} from "./kognitos-resource-ids";

function readString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

function readRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

/** UI-normalized exception state bucket. */
export type ExceptionStateUi =
  | "PENDING"
  | "ARCHIVED"
  | "RESOLVED"
  | "UNKNOWN";

export function normalizeExceptionState(raw: unknown): ExceptionStateUi {
  const s = readString(raw) ?? "";
  const u = s.toUpperCase();
  if (u.includes("PENDING")) return "PENDING";
  if (u.includes("ARCHIVED")) return "ARCHIVED";
  if (u.includes("RESOLVED")) return "RESOLVED";
  return "UNKNOWN";
}

export function groupLabelFromGroupResource(group: string | undefined): string {
  if (!group?.trim()) return "—";
  const parts = group.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  return last || "—";
}

export function assigneeShort(assignee: string | undefined): string | null {
  if (!assignee?.trim()) return null;
  const parts = assignee.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? assignee.trim();
}

export function formatLocation(loc: unknown): string {
  const o = readRecord(loc);
  if (!o) return "—";
  const start = readString(o.start_byte ?? o.startByte);
  const end = readString(o.end_byte ?? o.endByte);
  if (start != null && end != null) return `bytes ${start}–${end}`;
  try {
    return JSON.stringify(o);
  } catch {
    return "—";
  }
}

export type ExceptionSummaryDto = {
  exceptionId: string;
  state: ExceptionStateUi;
  groupLabel: string;
  title: string;
  automationId: string;
  automationDisplayName: string | null;
  runId: string | null;
  createTime: string | null;
  assigneeShort: string | null;
  executionId: string | null;
};

export function mapExceptionToSummary(
  raw: Record<string, unknown>,
  automationDisplayNameByAutomationId: Map<string, string>,
): ExceptionSummaryDto | null {
  const name =
    readString(raw.name) ??
    readString((raw as { exception?: string }).exception);
  const exceptionId =
    (name ? exceptionShortIdFromExceptionResourceName(name) : null) ??
    readString(raw.exception_id ?? raw.exceptionId);
  if (!exceptionId) return null;

  const runRes = runResourceStringFromExceptionRaw(raw);
  const runId = runRes ? runShortIdFromRunResourceName(runRes) : null;

  const autoRes = automationResourceStringFromExceptionRaw(raw);
  const automationId =
    (autoRes ? automationShortIdFromAutomationResourceName(autoRes) : null) ??
    "";

  const desc = readString(raw.description);
  const msg = readString(raw.message);
  const title = (desc ?? msg ?? "Exception").slice(0, 200);

  return {
    exceptionId,
    state: normalizeExceptionState(raw.state),
    groupLabel: groupLabelFromGroupResource(readString(raw.group)),
    title,
    automationId,
    automationDisplayName:
      (automationId && automationDisplayNameByAutomationId.get(automationId)) ||
      null,
    runId,
    createTime: readString(raw.create_time ?? raw.createTime) ?? null,
    assigneeShort: assigneeShort(readString(raw.assignee)),
    executionId: readString(raw.execution_id ?? raw.executionId) ?? null,
  };
}

export type ExceptionDetailDto = ExceptionSummaryDto & {
  messageFull: string;
  descriptionFull: string | null;
  locationDisplay: string;
  extra: Record<string, string>;
  automationResource: string | null;
  runResource: string | null;
  exceptionResourceName: string | null;
};

export function mapExceptionToDetail(
  raw: Record<string, unknown>,
  automationDisplayNameByAutomationId: Map<string, string>,
): ExceptionDetailDto | null {
  const s = mapExceptionToSummary(raw, automationDisplayNameByAutomationId);
  if (!s) return null;
  const name = readString(raw.name);
  const extraRaw = readRecord(raw.extra);
  const extra: Record<string, string> = {};
  if (extraRaw) {
    for (const [k, v] of Object.entries(extraRaw)) {
      if (typeof v === "string" && v.trim()) extra[k] = v.trim();
    }
  }
  return {
    ...s,
    messageFull: readString(raw.message) ?? "",
    descriptionFull: readString(raw.description) ?? null,
    locationDisplay: formatLocation(raw.location),
    extra,
    automationResource: automationResourceStringFromExceptionRaw(raw) ?? null,
    runResource: runResourceStringFromExceptionRaw(raw) ?? null,
    exceptionResourceName: name ?? null,
  };
}

/** Parsed multiple-choice style prompt from agent content or tool input (best-effort). */
export type ExceptionStructuredChoiceDto = {
  prompt: string;
  options: string[];
};

export type ExceptionEventState =
  | "STATE_UNSPECIFIED"
  | "STATE_STREAMING"
  | "STATE_COMPLETE";

export type ExceptionEventDto = {
  /**
   * Stable identifier derived from the Kognitos event resource name's last
   * path segment (e.g. `.../events/{event_id}`). Falls back to a synthetic id
   * built from `createTime` when `name` is missing so callers can still key
   * messages off this value.
   */
  id: string;
  /** Full Kognitos event resource name when present (`.../events/{event_id}`). */
  resourceName: string | null;
  state: ExceptionEventState;
  createTime: string | null;
  kind: string;
  summary: string;
  detail: string | null;
  /** Display name for `tool_call_request` events; preserved verbatim from Kognitos. */
  toolDisplayName?: string;
  /** Stable id linking `tool_call_request` to its matching `tool_call_result`. */
  toolCallId?: string;
  /** For `completion_response` events that carry an error payload. */
  completionError?: string;
  /** Present when the event looks like the agent asking the user to pick from a list. */
  structuredChoice?: ExceptionStructuredChoiceDto;
};

function eventTextFromUserMessage(o: Record<string, unknown>): string | null {
  return readString(o.content) ?? null;
}

function eventTextFromAgentMessage(o: Record<string, unknown>): string | null {
  return readString(o.content) ?? null;
}

const AGENT_LIST_LINE =
  /^\s*(?:(\d+)[\.)]\s+|[-*•]\s+)(.+)$/;

/**
 * Detects a trailing numbered or bullet list (2+ items) in agent markdown/text.
 * Prompt is the text above the list block.
 */
export function extractStructuredChoiceFromAgentContent(
  text: string,
): ExceptionStructuredChoiceDto | null {
  const t = text.trim();
  if (t.length < 8) return null;
  const lines = t.split(/\r?\n/);
  let i = lines.length - 1;
  const options: string[] = [];
  while (i >= 0) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      if (options.length === 0) {
        i -= 1;
        continue;
      }
      i -= 1;
      continue;
    }
    const m = trimmed.match(AGENT_LIST_LINE);
    if (m) {
      const opt = m[2].trim();
      if (opt) options.unshift(opt);
      i -= 1;
    } else {
      break;
    }
  }
  if (options.length < 2) return null;
  const deduped = dedupeChoiceOptions(options);
  if (deduped.length < 2) return null;
  const prompt = lines.slice(0, i + 1).join("\n").trim();
  return {
    prompt: prompt.length > 0 ? prompt : "Select an option:",
    options: deduped,
  };
}

function dedupeChoiceOptions(options: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of options) {
    const k = o.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(o);
  }
  return out;
}

function optionStringsFromArray(arr: unknown[]): string[] {
  const out: string[] = [];
  for (const x of arr) {
    if (typeof x === "string" && x.trim()) {
      out.push(x.trim());
      continue;
    }
    if (x && typeof x === "object" && !Array.isArray(x)) {
      const o = x as Record<string, unknown>;
      const label =
        readString(o.label) ??
        readString(o.name) ??
        readString(o.title) ??
        readString(o.value);
      if (label?.trim()) out.push(label.trim());
    }
  }
  return dedupeChoiceOptions(out);
}

function extractStructuredChoiceFromObject(
  o: Record<string, unknown>,
  depth: number,
): ExceptionStructuredChoiceDto | null {
  if (depth > 8) return null;
  const promptKeys = [
    "question",
    "prompt",
    "message",
    "title",
    "instruction",
    "text",
    "query",
    "ask",
  ] as const;
  let prompt = "";
  for (const k of promptKeys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) {
      prompt = v.trim();
      break;
    }
  }
  const arrayKeys = [
    "options",
    "choices",
    "values",
    "candidates",
    "suggestions",
    "items",
    "alternatives",
    "list",
  ] as const;
  for (const k of arrayKeys) {
    const v = o[k];
    if (!Array.isArray(v) || v.length < 2) continue;
    const opts = optionStringsFromArray(v);
    if (opts.length >= 2) {
      return {
        prompt: prompt.length > 0 ? prompt : "Select an option:",
        options: opts,
      };
    }
  }
  for (const v of Object.values(o)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = extractStructuredChoiceFromObject(v as Record<string, unknown>, depth + 1);
      if (inner) {
        if (!inner.prompt || inner.prompt === "Select an option:") {
          if (prompt) return { ...inner, prompt };
        }
        return inner;
      }
    }
    if (Array.isArray(v) && v.length >= 2) {
      const opts = optionStringsFromArray(v);
      if (opts.length >= 2) {
        return {
          prompt: prompt.length > 0 ? prompt : "Select an option:",
          options: opts,
        };
      }
    }
  }
  return null;
}

/**
 * Parses tool-call `input` JSON (or nested JSON string) for common choice shapes.
 */
export function extractStructuredChoiceFromToolInputJson(
  jsonStr: string,
): ExceptionStructuredChoiceDto | null {
  const trimmed = jsonStr.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) {
    const opts = optionStringsFromArray(parsed);
    if (opts.length >= 2) return { prompt: "Select an option:", options: opts };
    return null;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return extractStructuredChoiceFromObject(parsed as Record<string, unknown>, 0);
  }
  return null;
}

/** Newest matching event wins (events are oldest-first after mapListEventsResponse). */
export function findLatestStructuredAgentChoice(
  events: ExceptionEventDto[],
): ExceptionStructuredChoiceDto | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const sc = events[i].structuredChoice;
    if (sc && sc.options.length >= 2) return sc;
  }
  return null;
}

function eventIdFromResourceName(name: string): string | null {
  const parts = name.split("/").filter(Boolean);
  const i = parts.indexOf("events");
  if (i >= 0 && i + 1 < parts.length) return parts[i + 1] ?? null;
  return null;
}

function normalizeEventState(raw: unknown): ExceptionEventState {
  const s = readString(raw)?.toUpperCase() ?? "";
  if (s === "STATE_STREAMING") return "STATE_STREAMING";
  if (s === "STATE_COMPLETE") return "STATE_COMPLETE";
  return "STATE_UNSPECIFIED";
}

function mapOneEvent(raw: Record<string, unknown>, fallbackIndex: number): ExceptionEventDto {
  const createTime =
    readString(raw.create_time ?? raw.createTime) ?? null;
  const resourceName = readString(raw.name) ?? null;
  const state = normalizeEventState(raw.state);
  const id =
    (resourceName ? eventIdFromResourceName(resourceName) : null) ??
    `${createTime ?? "t"}-${fallbackIndex}`;
  const base = { id, resourceName, state, createTime };

  const um = readRecord(raw.user_message ?? raw.userMessage);
  if (um) {
    const t = eventTextFromUserMessage(um);
    return {
      ...base,
      kind: "user",
      summary: t ? t.slice(0, 160) : "User message",
      detail: t ?? null,
    };
  }
  const am = readRecord(raw.agent_message ?? raw.agentMessage);
  if (am) {
    const t = eventTextFromAgentMessage(am);
    const structuredChoice = t ? extractStructuredChoiceFromAgentContent(t) : null;
    return {
      ...base,
      kind: "agent",
      summary: t ? t.slice(0, 160) : "Agent message",
      detail: t ?? null,
      ...(structuredChoice ? { structuredChoice } : {}),
    };
  }
  const tc = readRecord(raw.tool_call_request ?? raw.toolCallRequest);
  if (tc) {
    const dn = readString(tc.display_name ?? tc.displayName) ?? "Tool call";
    const toolCallId = readString(tc.tool_call_id ?? tc.toolCallId);
    const inputStr = readString(tc.input) ?? null;
    const fromJson = inputStr ? extractStructuredChoiceFromToolInputJson(inputStr) : null;
    const structuredChoice =
      fromJson ??
      (inputStr ? extractStructuredChoiceFromAgentContent(inputStr) : null);
    return {
      ...base,
      kind: "tool",
      summary: dn,
      detail: inputStr,
      toolDisplayName: dn,
      ...(toolCallId ? { toolCallId } : {}),
      ...(structuredChoice ? { structuredChoice } : {}),
    };
  }
  const tr = readRecord(raw.tool_call_result ?? raw.toolCallResult);
  if (tr) {
    const toolCallId = readString(tr.tool_call_id ?? tr.toolCallId);
    return {
      ...base,
      kind: "tool_result",
      summary: "Tool result",
      detail: readString(tr.result) ?? null,
      ...(toolCallId ? { toolCallId } : {}),
    };
  }
  const sm = readRecord(raw.system_message ?? raw.systemMessage);
  if (sm) {
    const t = readString(sm.content);
    return {
      ...base,
      kind: "system",
      summary: t ? t.slice(0, 120) : "System",
      detail: t ?? null,
    };
  }
  const th = readRecord(raw.thinking);
  if (th) {
    const t = readString(th.content);
    return {
      ...base,
      kind: "thinking",
      summary: "Thinking",
      detail: t ?? null,
    };
  }
  const cr = readRecord(raw.completion_response ?? raw.completionResponse);
  if (cr) {
    const err = readString(cr.error);
    const ok = readString(cr.content);
    return {
      ...base,
      kind: "completion",
      summary: err ? `Completion error` : "Completion",
      detail: err ?? ok ?? null,
      ...(err ? { completionError: err } : {}),
    };
  }
  return {
    ...base,
    kind: "unknown",
    summary: "Event",
    detail: JSON.stringify(raw).slice(0, 500),
  };
}

/** Newest-first from API → oldest-first for timeline reading. */
export function mapListEventsResponse(
  raw: Record<string, unknown>,
): ExceptionEventDto[] {
  const list = (raw.events as unknown[]) ?? [];
  const out: ExceptionEventDto[] = [];
  let idx = 0;
  for (const item of list) {
    const r = readRecord(item);
    if (r) {
      out.push(mapOneEvent(r, idx));
      idx += 1;
    }
  }
  return out.reverse();
}

/**
 * Map a single streaming event payload (one NDJSON line from `StreamEvents`).
 * The wire format wraps the event under a `result` key so we unwrap when needed.
 */
export function mapStreamEventLine(
  raw: Record<string, unknown>,
): ExceptionEventDto | null {
  const evtRaw =
    (readRecord(raw.event) ??
      readRecord((raw as { result?: unknown }).result) ??
      raw) as Record<string, unknown>;
  if (!evtRaw) return null;
  return mapOneEvent(evtRaw, 0);
}

export type ExceptionRunContextDto = {
  runId: string | null;
  foundInDb: boolean;
  /** Small set for triage only. */
  keyValues: { label: string; value: string }[];
  inputFiles: { inputKey: string; fileName: string | null; kognitosFileId: string | null }[];
};

export function buildExceptionRunContext(options: {
  runId: string | null;
  payload: Record<string, unknown> | null;
  automationDisplayName: string | null;
}): ExceptionRunContextDto {
  const runId = options.runId;
  if (!runId || !options.payload) {
    return {
      runId,
      foundInDb: Boolean(runId && options.payload),
      keyValues: [],
      inputFiles: [],
    };
  }

  const dash = normalizeKognitosRowForDashboard({
    id: runId,
    payload: options.payload,
    update_time: null,
    create_time: null,
    automation_display_name: options.automationDisplayName,
  });

  const valueStr =
    dash.value > 0
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(dash.value)
      : "—";

  const keyValues: { label: string; value: string }[] = [
    { label: "Vendor", value: dash.vendor || "—" },
    { label: "Invoice #", value: dash.invoiceNumber?.trim() ? dash.invoiceNumber : "—" },
    { label: "Amount", value: valueStr },
    { label: "Run status", value: dash.runStatus || "—" },
    { label: "Pipeline", value: dash.pipeline || "—" },
  ];

  const refs = extractFileRefsFromKognitosPayload(options.payload).slice(0, 12);
  const inputFiles = refs.map((r) => ({
    inputKey: r.inputKey,
    fileName: r.inlineFileName,
    kognitosFileId:
      r.remote && !/^https?:\/\//i.test(r.remote)
        ? normalizeKognitosFileIdForDownload(r.remote)
        : null,
  }));

  return {
    runId,
    foundInDb: true,
    keyValues,
    inputFiles,
  };
}

export type ExceptionDetailBundleDto = {
  exception: ExceptionDetailDto;
  events: ExceptionEventDto[];
  runContext: ExceptionRunContextDto;
  eventsAgentIdUsed: string | null;
  /** Server-built Kognitos web URL for this run (null if env incomplete). */
  kognitosRunUrl: string | null;
};

/** Subset of OpenAPI `v1Event` returned after Create Event (POST …/agents/…/events). */
export type CreateEventAckDto = {
  eventResourceName: string | null;
  eventState: string | null;
  createTime: string | null;
  userMessagePreview: string | null;
};

export function mapCreateEventResponseToAck(
  raw: Record<string, unknown>,
): CreateEventAckDto {
  const name = readString(raw.name);
  const state = readString(raw.state);
  const createTime = readString(raw.create_time ?? raw.createTime);
  const um = readRecord(raw.user_message ?? raw.userMessage);
  const content = um ? readString(um.content) : undefined;
  const preview =
    content && content.length > 220 ? `${content.slice(0, 220)}…` : content ?? null;
  return {
    eventResourceName: name ?? null,
    eventState: state ?? null,
    createTime: createTime ?? null,
    userMessagePreview: preview,
  };
}
