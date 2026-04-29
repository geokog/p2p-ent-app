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

export type ExceptionEventDto = {
  createTime: string | null;
  kind: string;
  summary: string;
  detail: string | null;
};

function eventTextFromUserMessage(o: Record<string, unknown>): string | null {
  return readString(o.content) ?? null;
}

function eventTextFromAgentMessage(o: Record<string, unknown>): string | null {
  return readString(o.content) ?? null;
}

function mapOneEvent(raw: Record<string, unknown>): ExceptionEventDto {
  const createTime =
    readString(raw.create_time ?? raw.createTime) ?? null;
  const um = readRecord(raw.user_message ?? raw.userMessage);
  if (um) {
    const t = eventTextFromUserMessage(um);
    return {
      createTime,
      kind: "user",
      summary: t ? t.slice(0, 160) : "User message",
      detail: t ?? null,
    };
  }
  const am = readRecord(raw.agent_message ?? raw.agentMessage);
  if (am) {
    const t = eventTextFromAgentMessage(am);
    return {
      createTime,
      kind: "agent",
      summary: t ? t.slice(0, 160) : "Agent message",
      detail: t ?? null,
    };
  }
  const tc = readRecord(raw.tool_call_request ?? raw.toolCallRequest);
  if (tc) {
    const dn = readString(tc.display_name ?? tc.displayName) ?? "Tool call";
    return { createTime, kind: "tool", summary: dn, detail: readString(tc.input) ?? null };
  }
  const tr = readRecord(raw.tool_call_result ?? raw.toolCallResult);
  if (tr) {
    return {
      createTime,
      kind: "tool_result",
      summary: "Tool result",
      detail: readString(tr.result) ?? null,
    };
  }
  const sm = readRecord(raw.system_message ?? raw.systemMessage);
  if (sm) {
    const t = readString(sm.content);
    return {
      createTime,
      kind: "system",
      summary: t ? t.slice(0, 120) : "System",
      detail: t ?? null,
    };
  }
  const th = readRecord(raw.thinking);
  if (th) {
    const t = readString(th.content);
    return {
      createTime,
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
      createTime,
      kind: "completion",
      summary: err ? `Completion error` : "Completion",
      detail: err ?? ok ?? null,
    };
  }
  return {
    createTime,
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
  for (const item of list) {
    const r = readRecord(item);
    if (r) out.push(mapOneEvent(r));
  }
  return out.reverse();
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
