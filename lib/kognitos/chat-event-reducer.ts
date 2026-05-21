/**
 * Reduce raw Kognitos exception events (`ExceptionEventDto`) into the
 * discriminated `ChatMessageDto` union that the chat transcript renders.
 *
 * Mirrors the two-stage transport-then-enrich split used in bumblebee
 * (`convertEventToChatMessage` + `processIncomingThreadMessage`,
 * `/tmp/bumblebee/src/shared/utils/chat-utils.tsx`):
 *   1. `reduceEventToMessage` — fast, pure transformation per event.
 *   2. `applyMessageUpdate` — merges a streaming-update into an existing
 *      message store keyed by stable Kognitos event id, handling in-place
 *      updates when the same event id arrives multiple times during
 *      `STATE_STREAMING`.
 *
 * Keep this module dependency-light (no React, no DOM) so it can run on the
 * server (e.g. tests) and on the client.
 */

import type {
  ExceptionEventDto,
  ExceptionStructuredChoiceDto,
} from "./exception-view-model";
import {
  parseAstralAgentMessageContent,
  parseAstralUserMessageContent,
  type EditedFact,
  type ParsedGuideEntry,
  type ParsedRelatedOutputs,
} from "./astral-chat-xml";
import {
  extractFileIdFromSource,
  findInlineFileResourcePath,
  getFileDisplayName,
  getSourceDisplayName,
  guessMimeFromName,
  isFileResourceName,
} from "./file-resource";

export type ChatWidget =
  | { kind: "related-outputs"; data: ParsedRelatedOutputs }
  | { kind: "guide-entry"; data: ParsedGuideEntry }
  | { kind: "edit-facts"; data: EditedFact[] }
  | { kind: "button-group"; data: ExceptionStructuredChoiceDto }
  | { kind: "document-preview"; data: ChatDocumentPreviewData }
  | { kind: "form-fields"; data: ChatFormFieldsData };

export type ChatFormFieldType = "text" | "number" | "date" | "select";

export type ChatFormField = {
  name: string;
  label: string;
  type: ChatFormFieldType;
  required: boolean;
  default?: string;
  /** Options for `select` fields. */
  options?: string[];
  /** Optional helper / placeholder text. */
  placeholder?: string;
};

export type ChatFormFieldsData = {
  /** Optional title shown above the form. */
  title?: string;
  /** Optional helper text / instructions. */
  description?: string;
  fields: ChatFormField[];
};

export type ChatDocumentPreviewData = {
  /** Display label, e.g. filename or short id. */
  label: string;
  /** Optional Kognitos file id (when known). */
  fileId?: string;
  /** Optional remote URL (e.g. https://...). */
  url?: string;
  /** Optional MIME hint (e.g. application/pdf). */
  mimeType?: string;
};

/** Status for outgoing user messages (used by the optimistic store). */
export type ChatMessageStatus = "sending" | "sent" | "failed";

export type ChatMessageDto =
  | ChatTextMessage
  | ChatThinkingMessage
  | ChatToolCallMessage
  | ChatSystemErrorMessage
  | ChatSystemCompletionMessage;

type ChatBase = {
  /** Stable Kognitos event id (or synthetic id for optimistic outgoing messages). */
  id: string;
  createTime: string | null;
  /**
   * `true` while the underlying event is `STATE_STREAMING` (or the message
   * is an optimistic outgoing one waiting for the API to ack).
   */
  isStreaming: boolean;
};

export type ChatTextMessage = ChatBase & {
  kind: "text";
  role: "user" | "agent";
  /** Cleaned content after XML extraction; may be empty when widget-only. */
  content: string;
  widgets: ChatWidget[];
  /** Status for outgoing user messages. Always `"sent"` for messages from server events. */
  status?: ChatMessageStatus;
};

export type ChatThinkingMessage = ChatBase & {
  kind: "thinking";
  content: string;
};

export type ChatToolCallMessage = ChatBase & {
  kind: "tool-call";
  /** Friendly tool display name (e.g. "Search SAP"). */
  displayName: string;
  /** Tool input snippet for tooltip / debugging. */
  input: string | null;
  /** Tool call id, used to pair with `tool_call_result` events. */
  toolCallId?: string;
  /** Set to the matching tool result content once received. */
  result?: string | null;
  /** ISO timestamp when the result event arrived (used to compute elapsed time). */
  resultTime?: string | null;
};

export type ChatSystemErrorMessage = ChatBase & {
  kind: "system-error";
  /** Human-readable message describing the error. */
  message: string;
  /** Original detail / payload, when available. */
  detail?: string | null;
};

export type ChatSystemCompletionMessage = ChatBase & {
  kind: "system-completion";
  /** Final agent content, when present (`completion_response.content`). */
  content: string | null;
};

/** Detect the `<choices>…</choices>` envelope used for inline multi-choice prompts. */
const CHOICES_RE = /<choices[^>]*>([\s\S]*?)<\/choices>/i;

function extractChoicesWidget(
  content: string,
): { remaining: string; widget: ChatWidget } | null {
  const match = content.match(CHOICES_RE);
  if (!match) return null;
  const inner = match[1] ?? "";
  const items = Array.from(inner.matchAll(/<choice[^>]*>([\s\S]*?)<\/choice>/gi))
    .map((m) => m[1].trim())
    .filter(Boolean);
  if (items.length < 2) return null;
  const promptText = content.replace(CHOICES_RE, "").trim();
  return {
    remaining: promptText,
    widget: {
      kind: "button-group",
      data: {
        prompt: promptText || "Select an option:",
        options: items,
      },
    },
  };
}

/** Detect an inline `<form_fields>` payload. */
const FORM_FIELDS_RE = /<form_fields([^>]*)>([\s\S]*?)<\/form_fields>/i;

function readAttr(s: string, name: string): string | undefined {
  const m = s.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`));
  return m ? m[1] : undefined;
}

function normalizeFormFieldType(raw: string | undefined): ChatFormFieldType {
  const t = (raw ?? "").toLowerCase();
  if (t === "number" || t === "date" || t === "select") return t;
  return "text";
}

function extractFormFieldsWidget(
  content: string,
): { remaining: string; widget: ChatWidget } | null {
  const match = content.match(FORM_FIELDS_RE);
  if (!match) return null;
  const attrs = match[1] ?? "";
  const inner = match[2] ?? "";
  const title = readAttr(attrs, "title");
  const description = readAttr(attrs, "description");

  const fields: ChatFormField[] = [];
  const fieldMatches =
    inner.match(/<field\s+[^>]*(?:\/>|>[\s\S]*?<\/field>)/gi) ?? [];
  for (const f of fieldMatches) {
    const name = readAttr(f, "name");
    if (!name) continue;
    const label = readAttr(f, "label") ?? name;
    const type = normalizeFormFieldType(readAttr(f, "type"));
    const required =
      (readAttr(f, "required") ?? "").toLowerCase() === "true";
    const def = readAttr(f, "default");
    const placeholder = readAttr(f, "placeholder");
    const optionsRaw = readAttr(f, "options");
    const options = optionsRaw
      ? optionsRaw
          .split("|")
          .map((o) => o.trim())
          .filter(Boolean)
      : undefined;
    fields.push({
      name,
      label,
      type,
      required,
      ...(def !== undefined && { default: def }),
      ...(placeholder && { placeholder }),
      ...(options && options.length > 0 && { options }),
    });
  }
  if (fields.length === 0) return null;
  return {
    remaining: content.replace(FORM_FIELDS_RE, "").trim(),
    widget: {
      kind: "form-fields",
      data: {
        ...(title && { title }),
        ...(description && { description }),
        fields,
      },
    },
  };
}

/**
 * Detect `<file …>…</file>` or `kognitos://files/{id}` markers (rare; the
 * majority of agent file references arrive via `related_outputs source` or
 * inline `organizations/.../files/{id}` paths — see `collectDocumentWidgets`).
 */
const FILE_REF_RE =
  /<file(?:\s+([^>]*))?>([\s\S]*?)<\/file>|kognitos:\/\/files\/([A-Za-z0-9_\-:.]+)/gi;

function buildDocumentWidget(
  fileId: string,
  label?: string,
  mime?: string,
): ChatWidget {
  const labelOut = label ?? getFileDisplayName(fileId) ?? "Document";
  return {
    kind: "document-preview",
    data: {
      label: labelOut,
      ...(fileId && { fileId }),
      ...(mime && { mimeType: mime }),
    },
  };
}

/**
 * Walk an agent message and produce one document-preview widget per unique
 * file id referenced. We dedupe so the same invoice doesn't render twice when
 * both `<related_outputs source>` and a fact group's `source.name` point at
 * the same PDF.
 */
function collectDocumentWidgets(
  content: string,
  relatedOutputs: ParsedRelatedOutputs | null,
): { cleanedContent: string; widgets: ChatWidget[] } {
  const widgets: ChatWidget[] = [];
  const seenFileIds = new Set<string>();

  const pushFile = (rawSource: string) => {
    const fileId = extractFileIdFromSource(rawSource).trim();
    if (!fileId) return;
    if (seenFileIds.has(fileId)) return;
    seenFileIds.add(fileId);
    const label = getSourceDisplayName(rawSource) || fileId;
    const mime = guessMimeFromName(label);
    widgets.push(buildDocumentWidget(fileId, label, mime));
  };

  // 1. <related_outputs source="organizations/.../files/...">
  if (relatedOutputs?.source && isFileResourceName(relatedOutputs.source)) {
    pushFile(relatedOutputs.source);
  }
  // 2. <facts source="…"> per-group (newer format)
  for (const group of relatedOutputs?.factGroups ?? []) {
    const src = group.source?.name;
    if (src && isFileResourceName(src)) pushFile(src);
  }

  // 3. Inline org/.../files/... paths in plain prose (e.g. "Here is the
  //    invoice: organizations/abc/files/xxx--invoice.pdf"). Strip the path
  //    so we don't render the raw URL alongside the preview. Cap the loop at
  //    a small number of iterations to keep this O(n) per message.
  let cleaned = content;
  for (let i = 0; i < 16; i += 1) {
    const found = findInlineFileResourcePath(cleaned);
    if (!found) break;
    pushFile(found.match);
    cleaned = cleaned.replace(found.match, "").replace(/\s{2,}/g, " ").trim();
  }

  // 4. Explicit <file>/kognitos:// tags (legacy/rare path).
  cleaned = cleaned.replace(FILE_REF_RE, (_full, attrs?: string, inner?: string, uriId?: string) => {
    const innerTrim = (inner ?? "").trim();
    const fileId =
      innerTrim.match(/^[A-Za-z0-9_\-:.]+$/)?.[0] ??
      uriId ??
      attrs?.match(/\bid\s*=\s*["']([^"']+)["']/)?.[1] ??
      "";
    if (!fileId) return "";
    if (seenFileIds.has(fileId)) return "";
    seenFileIds.add(fileId);
    const explicitLabel = attrs?.match(/\bname\s*=\s*["']([^"']+)["']/)?.[1];
    const label = explicitLabel || innerTrim || getFileDisplayName(fileId) || fileId;
    const mime =
      attrs?.match(/\bmime\s*=\s*["']([^"']+)["']/)?.[1] ?? guessMimeFromName(label);
    widgets.push(buildDocumentWidget(fileId, label, mime));
    return "";
  });

  return {
    cleanedContent: cleaned.replace(/\s{3,}/g, "\n\n").trim(),
    widgets,
  };
}

/**
 * Reduce a single `ExceptionEventDto` into a `ChatMessageDto`, returning
 * `null` for events the chat transcript should ignore (e.g. orphaned tool
 * results — those are folded into the matching tool-call message via
 * {@link applyMessageUpdate}).
 */
export function reduceEventToMessage(
  event: ExceptionEventDto,
): ChatMessageDto | null {
  const isStreaming = event.state === "STATE_STREAMING";
  const base: ChatBase = {
    id: event.id,
    createTime: event.createTime,
    isStreaming,
  };

  if (event.kind === "user") {
    const raw = (event.detail ?? "").trim();
    if (!raw) return null;
    const parsed = parseAstralUserMessageContent(raw);
    const widgets: ChatWidget[] = [];
    if (parsed.editedFacts) {
      widgets.push({ kind: "edit-facts", data: parsed.editedFacts });
    }
    return {
      ...base,
      kind: "text",
      role: "user",
      content: parsed.cleanedContent,
      widgets,
      status: "sent",
    };
  }

  if (event.kind === "agent") {
    const raw = (event.detail ?? "").trim();
    if (!raw && !event.structuredChoice) return null;
    const parsed = parseAstralAgentMessageContent(raw);
    const widgets: ChatWidget[] = [];
    let content = parsed.cleanedContent;

    if (parsed.relatedOutputs) {
      widgets.push({ kind: "related-outputs", data: parsed.relatedOutputs });
    }
    if (parsed.guideEntry) {
      widgets.push({ kind: "guide-entry", data: parsed.guideEntry });
    }
    const choicesExtract = extractChoicesWidget(content);
    if (choicesExtract) {
      content = choicesExtract.remaining;
      widgets.push(choicesExtract.widget);
    }
    const formExtract = extractFormFieldsWidget(content);
    if (formExtract) {
      content = formExtract.remaining;
      widgets.push(formExtract.widget);
    }

    // Document widgets: explicit <file>/kognitos:// tag, file-resource sources
    // on related_outputs/<facts>, or a bare organizations/.../files/{id} path
    // dropped into prose (the way Astral surfaces invoices when asked to "show
    // me the invoice").
    const fileWidgets = collectDocumentWidgets(content, parsed.relatedOutputs);
    if (fileWidgets.cleanedContent !== content) {
      content = fileWidgets.cleanedContent;
    }
    for (const w of fileWidgets.widgets) widgets.push(w);

    if (
      widgets.length === 0 &&
      event.structuredChoice &&
      event.structuredChoice.options.length >= 2
    ) {
      widgets.push({ kind: "button-group", data: event.structuredChoice });
    }

    if (!content && widgets.length === 0) return null;

    return {
      ...base,
      kind: "text",
      role: "agent",
      content,
      widgets,
    };
  }

  if (event.kind === "thinking") {
    const text = (event.detail ?? "").trim();
    if (!text) return null;
    return { ...base, kind: "thinking", content: text };
  }

  if (event.kind === "tool") {
    const dn = event.toolDisplayName ?? event.summary ?? "Tool call";
    return {
      ...base,
      kind: "tool-call",
      displayName: dn,
      input: event.detail ?? null,
      ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
    };
  }

  if (event.kind === "completion") {
    if (event.completionError) {
      return {
        ...base,
        kind: "system-error",
        message: event.completionError,
        detail: event.detail ?? null,
        isStreaming: false,
      };
    }
    return {
      ...base,
      kind: "system-completion",
      content: event.detail ?? null,
      isStreaming: false,
    };
  }

  // tool_result is consumed by applyMessageUpdate; system messages are noise.
  return null;
}

/**
 * Returns a new message list that incorporates `event` either by appending a
 * brand-new entry, replacing a streaming entry with the same id, or folding
 * a `tool_call_result` into its matching `tool-call` message.
 *
 * This implementation is O(n) per event — fine for the chat sizes we expect.
 */
export function applyMessageUpdate(
  messages: ChatMessageDto[],
  event: ExceptionEventDto,
): ChatMessageDto[] {
  // Tool result: merge into matching tool-call (by toolCallId, then by id pairing).
  if (event.kind === "tool_result") {
    const result = event.detail ?? null;
    const toolCallId = event.toolCallId;
    let foundIndex = -1;
    if (toolCallId) {
      foundIndex = messages.findIndex(
        (m) => m.kind === "tool-call" && m.toolCallId === toolCallId,
      );
    }
    if (foundIndex < 0) {
      // Fall back to the most recent unfinished tool-call.
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (m.kind === "tool-call" && (m.result === undefined || m.isStreaming)) {
          foundIndex = i;
          break;
        }
      }
    }
    if (foundIndex < 0) return messages;
    const target = messages[foundIndex] as ChatToolCallMessage;
    const next = messages.slice();
    next[foundIndex] = {
      ...target,
      result,
      resultTime: event.createTime,
      isStreaming: false,
    };
    return next;
  }

  const message = reduceEventToMessage(event);
  if (!message) return messages;

  const existingIndex = messages.findIndex((m) => m.id === message.id);
  if (existingIndex < 0) {
    return [...messages, message];
  }

  const next = messages.slice();
  next[existingIndex] = mergeMessages(messages[existingIndex], message);
  return next;
}

function mergeMessages(
  prev: ChatMessageDto,
  next: ChatMessageDto,
): ChatMessageDto {
  // Same kind: prefer the newer streamed snapshot; otherwise keep prev's status.
  if (prev.kind === next.kind) {
    if (prev.kind === "text" && next.kind === "text") {
      return {
        ...next,
        widgets: next.widgets.length ? next.widgets : prev.widgets,
        status: next.status ?? prev.status,
      };
    }
    return next;
  }
  // Kind transition (e.g. thinking → text after stream resolves): take the new one.
  return next;
}

/**
 * Build the chat transcript from a (possibly partial) list of events.
 * Equivalent to repeatedly calling {@link applyMessageUpdate} from an empty
 * baseline, useful when re-deriving from the server snapshot.
 */
export function messagesFromEvents(
  events: readonly ExceptionEventDto[],
): ChatMessageDto[] {
  let acc: ChatMessageDto[] = [];
  for (const e of events) acc = applyMessageUpdate(acc, e);
  return acc;
}
