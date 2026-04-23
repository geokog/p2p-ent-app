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

/** Humanized SAP PO facet / maxlength summary, or raw book-wrapped facet payload. */
export function whySummaryIndicatesInvalidPoFormatSapFacet(
  whySummary: string,
): boolean {
  if (whySummary.trim().startsWith(SAP_PO_FACET_MAXLENGTH_HUMANIZED_PREFIX)) {
    return true;
  }
  return summarizeBookInvokerSapPoFacetMaxlengthViolation(whySummary) != null;
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
    summarizeVendorInvoiceMissingFromExtraction(desc) ??
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
 * Expert Queue index-error pattern (`List index 0 out of range for list of length 0`).
 * Shown in the UI with the **Missing Details** badge label.
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
 * Book-wrapped SAP Gateway **403** on the Purchase Order OData service (CM_CONSUMER / no auth).
 */
export function whySummaryIndicatesSapPoServiceUnauthorized(
  whySummary: string,
): boolean {
  const n = whySummary.toLowerCase();
  if (
    !n.includes("book invoker error") &&
    !n.includes("book service error")
  ) {
    return false;
  }
  if (!n.includes("no authorization to access service")) return false;
  if (
    !n.includes("purchaseorder") &&
    !n.includes("zapi_purchaseorder")
  ) {
    return false;
  }
  return n.includes("403") || n.includes("status code: 403");
}

/** Expert Queue explanation when the **Missing Invoice Number** badge applies. */
export const MISSING_VENDOR_INVOICE_HUMANIZED_EXPLANATION =
  "Could not find a vendor invoice number present for this entry.";

/**
 * Book extraction path: required **vendor invoice number** could not be read from the document.
 */
export function summarizeVendorInvoiceMissingFromExtraction(
  text: string,
): string | null {
  const n = text.toLowerCase();
  if (
    !n.includes("book invoker error") &&
    !n.includes("book service error")
  ) {
    return null;
  }
  const hasExtractionContext =
    n.includes("extractionerror") ||
    n.includes("unable to extract") ||
    n.includes("could not find");
  if (!hasExtractionContext) return null;
  const hasVendorFieldIssue =
    n.includes("could not find a vendor invoice number") ||
    n.includes("could not find the vendor invoice number") ||
    n.includes("'vendor_invoice_number'") ||
    n.includes('"vendor_invoice_number"');
  if (!hasVendorFieldIssue) return null;
  return MISSING_VENDOR_INVOICE_HUMANIZED_EXPLANATION;
}

export function whySummaryIndicatesMissingVendorInvoiceNumberFromExtraction(
  whySummary: string,
): boolean {
  if (whySummary.trim() === MISSING_VENDOR_INVOICE_HUMANIZED_EXPLANATION) {
    return true;
  }
  return summarizeVendorInvoiceMissingFromExtraction(whySummary) !== null;
}

/**
 * Book extraction path: required **`po_number`** could not be read from the document.
 */
export function whySummaryIndicatesMissingPoNumberFromExtraction(
  whySummary: string,
): boolean {
  const n = whySummary.toLowerCase();
  if (
    !n.includes("book invoker error") &&
    !n.includes("book service error")
  ) {
    return false;
  }
  if (!n.includes("po_number")) return false;
  const hasExtractionContext =
    n.includes("extractionerror") ||
    n.includes("unable to extract") ||
    n.includes("could not find");
  if (!hasExtractionContext) return false;
  return (
    n.includes("could not find a po number") ||
    n.includes("could not find the po number") ||
    n.includes("'po_number'") ||
    n.includes('"po_number"')
  );
}

/**
 * Single category badge for Expert Queue cards. First matching rule wins
 * (index “empty list” → Missing Details label, Posting Date, Book, Missing Invoice Number,
 * Missing PO Number, SAP Property None → Missing Details, SAP PO 403, Invalid PO Format, Other).
 */
export type ExpertQueueIssueBadge =
  | "po_not_found"
  | "posting_date"
  | "book"
  | "missing_invoice_number"
  | "missing_po_number"
  | "missing_details"
  | "sap_permissions_required"
  | "invalid_po_format"
  | "other";

export function expertQueueIssueBadgeFromWhySummary(
  whySummary: string,
): ExpertQueueIssueBadge {
  if (whySummaryIndicatesPoNotFoundLabel(whySummary)) return "po_not_found";
  if (whySummaryIndicatesPostingDateLabel(whySummary)) return "posting_date";
  if (whySummaryIndicatesBookInvokerKeywordsError(whySummary)) return "book";
  if (whySummaryIndicatesMissingVendorInvoiceNumberFromExtraction(whySummary)) {
    return "missing_invoice_number";
  }
  if (whySummaryIndicatesMissingPoNumberFromExtraction(whySummary)) {
    return "missing_po_number";
  }
  if (whySummaryIndicatesSapPoMissingDetails(whySummary)) {
    return "missing_details";
  }
  if (whySummaryIndicatesSapPoServiceUnauthorized(whySummary)) {
    return "sap_permissions_required";
  }
  if (whySummaryIndicatesInvalidPoFormatSapFacet(whySummary)) {
    return "invalid_po_format";
  }
  return "other";
}

/**
 * Dashboard-aligned validation dimensions (Runs Analyzed DOC / COA / VAL / QTY).
 * A run may carry several tags when multiple checks fail.
 */
export type ExpertQueueValidationTag =
  | "document_mismatch"
  | "coa_mismatch"
  | "value_mismatch"
  | "quantity_mismatch";

export const EXPERT_QUEUE_VALIDATION_TAG_LABEL: Record<
  ExpertQueueValidationTag,
  string
> = {
  document_mismatch: "Document mismatch",
  coa_mismatch: "COA mismatch / missing",
  value_mismatch: "Value mismatch",
  quantity_mismatch: "Quantity mismatch",
};

/**
 * Derives validation-queue tags from the same `inferValidationChecks` logic as the dashboard.
 * Callers should only use the result when the run has reached `state.completed` in the payload,
 * so tags are not shown for in-flight runs where inferred flags are not yet reliable.
 */
export function validationTagsFromDashboardChecks(checks: {
  docOk: boolean;
  qtyOk: boolean;
  valOk: boolean;
  coaOk: boolean;
}): ExpertQueueValidationTag[] {
  const t: ExpertQueueValidationTag[] = [];
  if (!checks.docOk) t.push("document_mismatch");
  if (!checks.coaOk) t.push("coa_mismatch");
  if (!checks.valOk) t.push("value_mismatch");
  if (!checks.qtyOk) t.push("quantity_mismatch");
  return t;
}

export function expertQueueWhySummaryForValidationTags(
  tags: ExpertQueueValidationTag[],
): string {
  const clauses: string[] = [];
  if (tags.includes("document_mismatch")) {
    clauses.push(
      "supplier invoice or PO identifiers do not line up with SAP (document mismatch)",
    );
  }
  if (tags.includes("coa_mismatch")) {
    clauses.push(
      "the certificate of analysis (COA) did not meet expectations or is missing",
    );
  }
  if (tags.includes("value_mismatch")) {
    clauses.push(
      "invoice amounts or values do not match the expected PO or GR totals (value mismatch)",
    );
  }
  if (tags.includes("quantity_mismatch")) {
    clauses.push(
      "quantities or units on the invoice do not match the purchase order or receipt (quantity mismatch)",
    );
  }
  if (clauses.length === 0) return "";
  const tail = clauses[clauses.length - 1]!;
  const body =
    clauses.length === 1
      ? tail
      : `${clauses.slice(0, -1).join(", ")}, and ${tail}`;
  return `Automated validation flagged that ${body}. Review the comparison in the run report and correct master data or supporting documents before retrying.`;
}

export const whyThisMattersValidationQueue =
  "These runs still fail one or more P2P validation checks used on the Runs Analyzed dashboard, so posting or payment should not proceed until they are resolved.";

export function resolutionStepsForValidationQueue(): string[] {
  return [
    "Open the run in Kognitos or review the validation report in this app to see expected vs. actual values.",
    "Correct documents, COA, quantities, or amounts as needed, then follow your process to re-run or clear the automation.",
    "Confirm on the Runs Analyzed dashboard that DOC, QTY, VAL, and COA all pass before relying on the outcome.",
  ];
}

/** Row returned by GET /api/kognitos/expert-queue for the Expert Queue UI. */
export type ExpertQueueRow = {
  runId: string;
  automationDisplayName: string;
  /** Vendor / supplier display name from the same normalization as dashboard runs. */
  vendor: string;
  invoiceNumber: string;
  /** Parsed invoice line value in USD. */
  value: number;
  stateLabel: string;
  issueKind: ExpertQueueIssueKind;
  /** Plain-language “why care” copy for the page (no technical jargon). */
  whyItMatters: string;
  whySummary: string;
  /** One category label for the run (see `ExpertQueueIssueBadge`). */
  issueBadge: ExpertQueueIssueBadge;
  /**
   * When any DOC / COA / VAL / QTY check fails per dashboard `inferValidationChecks`,
   * lists which dimensions failed (may coexist with `issueBadge` from Kognitos state).
   */
  validationTags?: ExpertQueueValidationTag[];
  referenceId?: string;
  locationHint?: string;
  resolutionSteps: string[];
  kognitosRunUrl: string | null;
  /** User inputs include an "Invoice Document" field on the run payload. */
  hasInvoiceDocumentInput: boolean;
  /**
   * Same-origin PDF proxy when Kognitos file download is configured and a run invoice
   * file can be resolved (same logic as the Runs Analyzed table).
   */
  invoicePdfUrl: string | null;
  updateTime: string | null;
  createTime: string | null;
};
