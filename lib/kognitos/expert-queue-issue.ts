/**
 * Parses Kognitos run `payload.state` for runs that need expert attention
 * (`failed` or `awaiting_guidance` per v1RunState).
 */

export type ExpertQueueIssueKind = "failed" | "awaiting_guidance";

export type ExpertQueueIssue = {
  kind: ExpertQueueIssueKind;
  /** Primary human explanation from the API (description field). */
  whySummary: string;
  /** Failed: error id. Awaiting guidance: exception id in Guidance Center. */
  referenceId?: string;
  /** Byte span or other location metadata when present. */
  locationHint?: string;
};

function runStateObject(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const st = payload.state;
  if (!st || typeof st !== "object" || Array.isArray(st)) return null;
  return st as Record<string, unknown>;
}

function readString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.stringValue === "string" && o.stringValue.trim()) {
    return o.stringValue.trim();
  }
  if (typeof o.string_value === "string" && o.string_value.trim()) {
    return o.string_value.trim();
  }
  return undefined;
}

function formatLocation(loc: unknown): string | undefined {
  if (!loc || typeof loc !== "object" || Array.isArray(loc)) return undefined;
  const o = loc as Record<string, unknown>;
  const start = o.start_byte ?? o.startByte;
  const end = o.end_byte ?? o.endByte;
  if (start != null && end != null) {
    return `The platform recorded where in the automation this showed up (between positions ${String(start)} and ${String(end)}).`;
  }
  return undefined;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function formatEnglishList(items: string[]): string {
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function parsePeriodToken(token: string): { label: string; sortKey: number } | null {
  const t = token.trim();
  const m = t.match(/^(\d{1,2})\s+(\d{4})$/);
  if (!m) return null;
  const mo = parseInt(m[1]!, 10);
  const y = parseInt(m[2]!, 10);
  if (mo < 1 || mo > 12 || !Number.isFinite(y)) return null;
  const label = `${MONTH_NAMES[mo - 1]} ${y}`;
  const sortKey = y * 12 + mo;
  return { label, sortKey };
}

/**
 * When SAP returns M8/535-style posting period text inside a long traceback or JSON,
 * return a single plain sentence for the Expert Queue “what happened” area.
 */
export function summarizeSapPostingPeriodIssue(text: string): string | null {
  const re =
    /Allowed posting periods:\s*([\s\S]+?)\s+for\s+company\s+code\s+(\d+)\s+and\s+date\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/i;
  const m = text.match(re);
  if (!m) return null;

  const periodPart = m[1]!.replace(/\s+/g, " ").trim();
  const company = m[2]!;
  const dateEu = `${m[3]!.padStart(2, "0")}.${m[4]!.padStart(2, "0")}.${m[5]!}`;

  const rawTokens = periodPart.split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean);
  const labels = rawTokens
    .map(parsePeriodToken)
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((x) => x.label);

  if (labels.length === 0) return null;

  const periodList = formatEnglishList(labels);
  return `SAP will not post for company code ${company} on date ${dateEu}, because for that company only these posting periods are allowed: ${periodList}.`;
}

/**
 * Book service expected a document or text, but the value was the wrong kind
 * (`Union[File, Text]` type mismatch in the technical payload).
 */
export function summarizeBookInvokerFileOrTextMismatch(text: string): string | null {
  const n = text.toLowerCase();
  if (
    !n.includes("book invoker error") &&
    !n.includes("book service error")
  ) {
    return null;
  }
  const fileOrTextUnion =
    n.includes("union[file, text]") || n.includes("union[text, file]");
  if (!n.includes("type mismatch") || !fileOrTextUnion) return null;

  return (
    "The automation expected a document or plain text, but what was supplied wasn't " +
    "recognized as either. Please provide an uploaded file or clear text and try again."
  );
}

/** Humanized copy for `TypeError: keywords must be strings` on the book path. */
export const BOOK_KEYWORDS_MUST_BE_STRINGS_HUMANIZED =
  "This step stopped because a keyword argument wasn't plain text. " +
  "The automation only accepts simple string names for each option. " +
  "Review how this step is called or configured, then try again.";

const BOOK_KEYWORDS_MUST_BE_STRINGS_PREFIX =
  "This step stopped because a keyword argument wasn't plain text.";

/**
 * Book service: keyword arguments must be plain strings (`TypeError: keywords must be strings`).
 */
export function summarizeBookInvokerKeywordsMustBeStrings(
  text: string,
): string | null {
  const n = text.toLowerCase();
  if (
    !n.includes("book invoker error") &&
    !n.includes("book service error")
  ) {
    return null;
  }
  if (!n.includes("keywords must be strings")) return null;
  return BOOK_KEYWORDS_MUST_BE_STRINGS_HUMANIZED;
}

/** Prefix of humanized SAP PO facet / maxlength copy (for tests or future badge logic). */
export const SAP_PO_FACET_MAXLENGTH_HUMANIZED_PREFIX =
  "SAP could not update the purchase order because a value exceeds the length SAP allows for that field";

/**
 * Book-wrapped SAP PO OData facet error: value longer than `maxlength` (e.g. MM-PUR-PO).
 */
export function summarizeBookInvokerSapPoFacetMaxlengthViolation(
  text: string,
): string | null {
  const n = text.toLowerCase();
  if (
    !n.includes("book invoker error") &&
    !n.includes("book service error")
  ) {
    return null;
  }
  if (!n.includes("violates facet") || !n.includes("maxlength")) return null;

  const capM = text.match(/maxlength=(\d+)/i);
  const cap = capM?.[1];
  if (cap) {
    return `${SAP_PO_FACET_MAXLENGTH_HUMANIZED_PREFIX} (maximum ${cap} characters). Shorten it and try again.`;
  }
  return `${SAP_PO_FACET_MAXLENGTH_HUMANIZED_PREFIX}. Shorten it and try again.`;
}

function humanizedIssueDescription(
  desc: string | undefined,
  fallback: string,
): string {
  if (!desc) return fallback;
  return (
    summarizeSapPostingPeriodIssue(desc) ??
    summarizeBookInvokerFileOrTextMismatch(desc) ??
    summarizeBookInvokerKeywordsMustBeStrings(desc) ??
    summarizeBookInvokerSapPoFacetMaxlengthViolation(desc) ??
    desc
  );
}

/** Short, non-technical explanation of why the user should care (shown before run details). */
export function whyThisMattersPlainLanguage(kind: ExpertQueueIssueKind): string {
  if (kind === "failed") {
    return "A failed run means the work this automation was doing stopped before it could finish. That often leaves related tasks—like checking an invoice or moving a payment—waiting until someone fixes what went wrong.";
  }
  return "A run awaiting guidance is paused on purpose until the right person answers a question or makes a decision in Kognitos. Until that happens, anything that depends on this run cannot move forward.";
}

/**
 * If the run is in `failed` or `awaiting_guidance`, returns issue details; otherwise null.
 */
export function parseExpertQueueIssue(
  payload: Record<string, unknown>,
): ExpertQueueIssue | null {
  const s = runStateObject(payload);
  if (!s) return null;

  const failed = s.failed ?? s.Failed;
  if (failed && typeof failed === "object" && !Array.isArray(failed)) {
    const o = failed as Record<string, unknown>;
    const desc = readString(o.description);
    const id = readString(o.id);
    const loc = formatLocation(o.location ?? o.Location);
    return {
      kind: "failed",
      whySummary: humanizedIssueDescription(
        desc,
        "Kognitos reported this run as failed. Open the run in Kognitos for full error context.",
      ),
      referenceId: id,
      locationHint: loc,
    };
  }

  const ag =
    s.awaitingGuidance ?? s.awaiting_guidance ?? s.AwaitingGuidance;
  if (ag && typeof ag === "object" && !Array.isArray(ag)) {
    const o = ag as Record<string, unknown>;
    const desc = readString(o.description);
    const exc = readString(o.exception ?? o.Exception);
    const loc = formatLocation(o.location ?? o.Location);
    return {
      kind: "awaiting_guidance",
      whySummary: humanizedIssueDescription(
        desc,
        "This run is paused until someone provides guidance in Kognitos.",
      ),
      referenceId: exc,
      locationHint: loc,
    };
  }

  return null;
}

export function resolutionStepsForIssue(issue: ExpertQueueIssue): string[] {
  if (issue.kind === "failed") {
    return [
      "Open the run in Kognitos (use the run link) and review the error details and any code location shown.",
      "Fix the root cause: correct bad input data, repair a connection or credential, or update the automation logic if the failure is a bug.",
      "Re-invoke the automation or follow your team’s procedure for retrying failed runs once the cause is addressed.",
    ];
  }
  return [
    "Open Kognitos and go to the Guidance Center (or follow your org’s link from the run).",
    "Locate the exception for this run and answer the guidance question or apply the required business decision.",
    "After guidance is applied, continue or resume the run in Kognitos so it can move toward completion.",
  ];
}

export function stateLabelForIssue(kind: ExpertQueueIssueKind): string {
  return kind === "failed" ? "Failed" : "Awaiting guidance";
}

/**
 * Expert Queue **PO Not Found** badge: the common empty-list index error
 * (`List index 0 out of range for list of length 0`).
 */
export function whySummaryIndicatesPoNotFoundLabel(whySummary: string): boolean {
  const n = whySummary.trim().toLowerCase();
  return (
    n.includes("index error") &&
    n.includes("list index 0") &&
    n.includes("out of range") &&
    n.includes("length 0")
  );
}

/**
 * Expert Queue **Posting Date** badge: SAP posting period / company-date messages
 * (humanized or raw “Allowed posting periods…” text).
 */
export function whySummaryIndicatesPostingDateLabel(whySummary: string): boolean {
  const t = whySummary.trim();
  const n = t.toLowerCase();

  if (whySummaryIndicatesPoNotFoundLabel(whySummary)) return false;

  if (t.startsWith("SAP will not post for company code")) return true;
  return n.includes("allowed posting periods") && n.includes("company code");
}

/** `TypeError: keywords must be strings` from the book path (raw or humanized). */
export function whySummaryIndicatesBookInvokerKeywordsError(
  whySummary: string,
): boolean {
  const t = whySummary.trim();
  if (t.startsWith(BOOK_KEYWORDS_MUST_BE_STRINGS_PREFIX)) return true;
  const n = whySummary.toLowerCase();
  return (
    (n.includes("book invoker error") || n.includes("book service error")) &&
    n.includes("keywords must be strings")
  );
}

/** SAP PO OData: `Property None` on `A_PurchaseOrderType` (HTTP 400). */
export function whySummaryIndicatesSapPoMissingDetails(
  whySummary: string,
): boolean {
  const n = whySummary.toLowerCase();
  return n.includes("property none not found in type a_purchaseordertype");
}

/**
 * Single category badge for Expert Queue cards. First matching rule wins
 * (PO Not Found → Posting Date → Book → Missing Details → Other).
 */
export type ExpertQueueIssueBadge =
  | "po_not_found"
  | "posting_date"
  | "book"
  | "missing_details"
  | "other";

export function expertQueueIssueBadgeFromWhySummary(
  whySummary: string,
): ExpertQueueIssueBadge {
  if (whySummaryIndicatesPoNotFoundLabel(whySummary)) return "po_not_found";
  if (whySummaryIndicatesPostingDateLabel(whySummary)) return "posting_date";
  if (whySummaryIndicatesBookInvokerKeywordsError(whySummary)) return "book";
  if (whySummaryIndicatesSapPoMissingDetails(whySummary)) {
    return "missing_details";
  }
  return "other";
}

/** Row returned by GET /api/kognitos/expert-queue for the Expert Queue UI. */
export type ExpertQueueRow = {
  runId: string;
  automationDisplayName: string;
  stateLabel: string;
  issueKind: ExpertQueueIssueKind;
  /** Plain-language “why care” copy for the page (no technical jargon). */
  whyItMatters: string;
  whySummary: string;
  /** One category label for the run (PO Not Found, Posting Date, Book, Missing Details, Other). */
  issueBadge: ExpertQueueIssueBadge;
  referenceId?: string;
  locationHint?: string;
  resolutionSteps: string[];
  kognitosRunUrl: string | null;
  updateTime: string | null;
  createTime: string | null;
};
